import crypto from 'node:crypto';
import { decode, decodeFirst } from '../utils/cbor.js';

/**
 * Device biometric unlock through WebAuthn - US-05 (#17), SRS HI-2.
 *
 * A browser cannot read a fingerprint or a face, and must not: the platform
 * authenticator (Touch ID, Windows Hello, Android biometrics) checks the
 * person on the device and then signs a server challenge with a private key
 * that never leaves the device. This module is the server half: it checks that
 * signature. Nothing here can be satisfied by the client merely saying "it
 * worked" - only a valid signature from the enrolled key over the server's own
 * single-use challenge passes.
 *
 * The verification follows W3C WebAuthn Level 2 section 7.1 (registration) and
 * 7.2 (assertion), using only node:crypto. Supported key types are ES256
 * (P-256) and RS256 (RSA, 2048 bits or more), which cover the platform
 * authenticators in current browsers. Attestation statements are not
 * evaluated: the server asks for none ("attestation: none") because it needs
 * the public key, not proof of which device model made it.
 */

export class WebAuthnError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'WebAuthnError';
    this.reason = reason;
  }
}

export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const KNOWN_TRANSPORTS = new Set(['internal', 'hybrid', 'usb', 'nfc', 'ble']);

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

export function fromBase64Url(value) {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.length % 4 === 1) {
    throw new WebAuthnError('malformed_base64url');
  }

  return Buffer.from(value, 'base64url');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function sameText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** A fresh random challenge, base64url. */
export function newChallenge() {
  return toBase64Url(crypto.randomBytes(32));
}

/**
 * The relying party the credentials are bound to. A credential made for one
 * origin is useless on any other, which is what stops a look-alike site from
 * asking for the unlock.
 */
export function relyingParty(env = process.env) {
  let origin = env.WEBAUTHN_ORIGIN || env.CLIENT_ORIGIN;

  if (!origin || origin === '*') origin = 'http://localhost:5173';

  const url = new URL(origin);

  return {
    id: env.WEBAUTHN_RP_ID || url.hostname,
    name: 'Personal Finance Expense Manager',
    origin: url.origin,
  };
}

function cleanTransports(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.filter((item) => KNOWN_TRANSPORTS.has(item)))];
}

// ---------------------------------------------------------------------------
// Options sent to the browser
// ---------------------------------------------------------------------------

export function buildRegistrationOptions({ user, challenge, rp, existing = [] }) {
  return {
    challenge,
    rp: { id: rp.id, name: rp.name },
    user: {
      // An opaque handle, never the e-mail address.
      id: toBase64Url(Buffer.from(String(user._id), 'hex')),
      name: user.email,
      displayName: user.name,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    // Only the device's own sensor, and only with the person verified on it.
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'discouraged',
    },
    attestation: 'none',
    timeout: CHALLENGE_TTL_MS,
    excludeCredentials: existing.map((credential) => ({
      type: 'public-key',
      id: credential.credential_id,
      transports: credential.transports,
    })),
  };
}

export function buildAuthenticationOptions({ challenge, rp, credentials }) {
  return {
    challenge,
    rpId: rp.id,
    userVerification: 'required',
    timeout: CHALLENGE_TTL_MS,
    allowCredentials: credentials.map((credential) => ({
      type: 'public-key',
      id: credential.credential_id,
      transports: credential.transports,
    })),
  };
}

// ---------------------------------------------------------------------------
// Parsing and checking
// ---------------------------------------------------------------------------

function checkClientData(encoded, expectedType, expectedChallenge, expectedOrigin) {
  const raw = fromBase64Url(encoded);

  if (raw.length === 0 || raw.length > 4096) throw new WebAuthnError('client_data_size');

  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebAuthnError('client_data_json');
  }

  if (!data || typeof data !== 'object') throw new WebAuthnError('client_data_json');
  if (data.type !== expectedType) throw new WebAuthnError('client_data_type');

  if (typeof data.challenge !== 'string' || !sameText(data.challenge, expectedChallenge)) {
    throw new WebAuthnError('challenge_mismatch');
  }

  if (data.origin !== expectedOrigin) throw new WebAuthnError('origin_mismatch');
  if (data.crossOrigin === true) throw new WebAuthnError('cross_origin');

  return raw;
}

/** Split authenticator data (WebAuthn section 6.1) into its parts. */
export function parseAuthenticatorData(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 37) {
    throw new WebAuthnError('authenticator_data_size');
  }

  const flags = buffer[32];
  const parsed = {
    rpIdHash: buffer.subarray(0, 32),
    userPresent: (flags & FLAG_UP) !== 0,
    userVerified: (flags & FLAG_UV) !== 0,
    hasAttestedCredential: (flags & FLAG_AT) !== 0,
    signCount: buffer.readUInt32BE(33),
  };

  if (!parsed.hasAttestedCredential) return parsed;

  if (buffer.length < 55) throw new WebAuthnError('authenticator_data_size');

  const idLength = buffer.readUInt16BE(53);

  if (idLength === 0 || idLength > 1023 || buffer.length < 55 + idLength) {
    throw new WebAuthnError('credential_id_size');
  }

  parsed.credentialId = Buffer.from(buffer.subarray(55, 55 + idLength));
  parsed.credentialPublicKey = decodeFirst(buffer, 55 + idLength).value;

  return parsed;
}

/** Turn a COSE public key into SPKI DER bytes that node:crypto can verify with. */
export function coseKeyToSpki(cose) {
  if (!(cose instanceof Map)) throw new WebAuthnError('cose_key');

  const kty = cose.get(1);
  const alg = cose.get(3);
  let jwk;

  if (kty === 2 && alg === -7) {
    const curve = cose.get(-1);
    const x = cose.get(-2);
    const y = cose.get(-3);

    if (curve !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
      throw new WebAuthnError('cose_key');
    }

    jwk = { kty: 'EC', crv: 'P-256', x: toBase64Url(x), y: toBase64Url(y) };
  } else if (kty === 3 && alg === -257) {
    const n = cose.get(-1);
    const e = cose.get(-2);

    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || e.length === 0 || e.length > 8) {
      throw new WebAuthnError('cose_key');
    }

    jwk = { kty: 'RSA', n: toBase64Url(n), e: toBase64Url(e) };
  } else {
    throw new WebAuthnError('unsupported_algorithm');
  }

  try {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' });
  } catch {
    // For example a point that is not on the curve.
    throw new WebAuthnError('cose_key');
  }
}

function checkCredentialShape(credential, fields) {
  if (
    !credential ||
    typeof credential !== 'object' ||
    credential.type !== 'public-key' ||
    typeof credential.id !== 'string' ||
    credential.id.length === 0 ||
    credential.id.length > 1400 ||
    !BASE64URL.test(credential.id) ||
    !credential.response ||
    typeof credential.response !== 'object'
  ) {
    throw new WebAuthnError('credential_shape');
  }

  for (const field of fields) {
    const value = credential.response[field];

    if (typeof value !== 'string' || value.length === 0 || value.length > 16384) {
      throw new WebAuthnError('credential_shape');
    }
  }
}

function checkAuthenticatorFlags(auth, rp) {
  if (!crypto.timingSafeEqual(auth.rpIdHash, sha256(rp.id))) throw new WebAuthnError('rp_id_mismatch');
  if (!auth.userPresent) throw new WebAuthnError('user_not_present');
  // The whole point: the person was verified on the device (fingerprint, face
  // or the device's own screen-lock) before the authenticator signed.
  if (!auth.userVerified) throw new WebAuthnError('user_not_verified');
}

/**
 * Check the result of navigator.credentials.create() and return what to store.
 * Throws WebAuthnError(reason) for anything that does not check out.
 */
export function verifyRegistration({ credential, challenge, rp }) {
  try {
    checkCredentialShape(credential, ['clientDataJSON', 'attestationObject']);
    checkClientData(credential.response.clientDataJSON, 'webauthn.create', challenge, rp.origin);

    const attestation = decode(fromBase64Url(credential.response.attestationObject));

    if (!(attestation instanceof Map)) throw new WebAuthnError('attestation_object');

    const authData = attestation.get('authData');

    if (!Buffer.isBuffer(authData)) throw new WebAuthnError('attestation_object');

    const auth = parseAuthenticatorData(authData);

    checkAuthenticatorFlags(auth, rp);

    if (!auth.hasAttestedCredential) throw new WebAuthnError('no_credential_data');

    const credentialId = toBase64Url(auth.credentialId);

    if (credentialId !== credential.id) throw new WebAuthnError('credential_id_mismatch');

    return {
      credentialId,
      publicKey: coseKeyToSpki(auth.credentialPublicKey).toString('base64'),
      signCount: auth.signCount,
      transports: cleanTransports(credential.response.transports),
    };
  } catch (error) {
    throw asWebAuthnError(error);
  }
}

/**
 * Check the result of navigator.credentials.get() against the stored key.
 * `stored` is { publicKey (base64 SPKI), signCount }. Returns the new counter.
 */
export function verifyAssertion({ credential, challenge, rp, stored }) {
  try {
    checkCredentialShape(credential, ['clientDataJSON', 'authenticatorData', 'signature']);

    const clientData = checkClientData(
      credential.response.clientDataJSON,
      'webauthn.get',
      challenge,
      rp.origin
    );

    const authData = fromBase64Url(credential.response.authenticatorData);
    const auth = parseAuthenticatorData(authData);

    checkAuthenticatorFlags(auth, rp);

    const signature = fromBase64Url(credential.response.signature);
    const signedData = Buffer.concat([authData, sha256(clientData)]);

    let valid = false;
    try {
      const key = crypto.createPublicKey({
        key: Buffer.from(stored.publicKey, 'base64'),
        format: 'der',
        type: 'spki',
      });

      // The algorithm follows the key: ECDSA (DER signature) for P-256 and
      // RSASSA-PKCS1-v1_5 for RSA, both over SHA-256.
      valid = crypto.verify('sha256', signedData, key, signature);
    } catch {
      valid = false;
    }

    if (!valid) throw new WebAuthnError('bad_signature');

    // A counter that does not move forward means the key may have been cloned.
    // Authenticators that never count always report 0, which is allowed.
    if ((auth.signCount !== 0 || stored.signCount !== 0) && auth.signCount <= stored.signCount) {
      throw new WebAuthnError('sign_count_regressed');
    }

    return { signCount: auth.signCount };
  } catch (error) {
    throw asWebAuthnError(error);
  }
}

function asWebAuthnError(error) {
  return error instanceof WebAuthnError ? error : new WebAuthnError('malformed');
}
