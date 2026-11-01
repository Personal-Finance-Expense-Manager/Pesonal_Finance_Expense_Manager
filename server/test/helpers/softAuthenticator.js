import crypto from 'node:crypto';

/**
 * A software WebAuthn authenticator FOR TESTS ONLY - US-05 (#17).
 *
 * In a real browser the private key lives in the device's secure hardware and
 * is released only after a fingerprint, a face or the screen-lock. A test has
 * no sensor, so this stands in for the device: it makes a real key pair and
 * produces genuine registration and assertion messages (real CBOR, real
 * signatures) that the server must verify exactly as it would for a phone.
 *
 * Nothing in src/ imports this file, and the server has no switch that accepts
 * an unsigned or "pre-approved" biometric. The tests below prove that.
 */

const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

// -- a tiny CBOR encoder: integers, byte strings, text, arrays, maps ---------

function head(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  if (value < 0x10000) {
    const out = Buffer.alloc(3);
    out[0] = (major << 5) | 25;
    out.writeUInt16BE(value, 1);
    return out;
  }
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(value, 1);
  return out;
}

export function encodeCbor(value) {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, text.length), text]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  if (value instanceof Map) {
    const parts = [head(5, value.size)];
    for (const [key, item] of value) parts.push(encodeCbor(key), encodeCbor(item));
    return Buffer.concat(parts);
  }
  if (value === true) return Buffer.from([0xf5]);
  if (value === false) return Buffer.from([0xf4]);
  if (value === null) return Buffer.from([0xf6]);
  throw new Error('encodeCbor: unsupported value');
}

const b64url = (buffer) => Buffer.from(buffer).toString('base64url');

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_AT = 0x40;

/**
 * @param {object} config
 * @param {string} config.rpId     the relying party id the device binds to
 * @param {string} config.origin   the origin the "browser" reports
 * @param {'ES256'|'RS256'} [config.algorithm]
 */
export function createSoftAuthenticator({ rpId, origin, algorithm = 'ES256' }) {
  const keys =
    algorithm === 'RS256'
      ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
      : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

  const credentialId = crypto.randomBytes(32);
  let counter = 0;

  function coseKey(publicKey = keys.publicKey) {
    const jwk = publicKey.export({ format: 'jwk' });

    if (jwk.kty === 'RSA') {
      return new Map([
        [1, 3],
        [3, -257],
        [-1, Buffer.from(jwk.n, 'base64url')],
        [-2, Buffer.from(jwk.e, 'base64url')],
      ]);
    }

    return new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]);
  }

  function authenticatorData({ flags, signCount, attested, rpIdForHash = rpId, cose }) {
    const header = Buffer.alloc(37);
    sha256(rpIdForHash).copy(header, 0);
    header[32] = flags;
    header.writeUInt32BE(signCount, 33);

    if (!attested) return header;

    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(credentialId.length, 0);

    return Buffer.concat([
      header,
      Buffer.alloc(16), // AAGUID
      idLength,
      credentialId,
      encodeCbor(cose ?? coseKey()),
    ]);
  }

  function clientData(type, challenge, overrides = {}) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false, ...overrides }),
      'utf8'
    );
  }

  return {
    algorithm,
    credentialId,
    id: b64url(credentialId),
    publicKey: keys.publicKey,

    /**
     * What navigator.credentials.create() returns after the person is
     * verified on the device. `tweaks` break one thing at a time for the
     * negative tests.
     */
    register(options, tweaks = {}) {
      const authData = authenticatorData({
        flags: tweaks.flags ?? FLAG_UP | FLAG_UV | FLAG_AT,
        signCount: tweaks.signCount ?? 0,
        attested: true,
        rpIdForHash: tweaks.rpId,
        cose: tweaks.cose,
      });

      const attestation = encodeCbor(
        new Map([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ])
      );

      return {
        id: tweaks.id ?? b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(
            clientData(
              tweaks.type ?? 'webauthn.create',
              tweaks.challenge ?? options.challenge,
              tweaks.origin ? { origin: tweaks.origin } : {}
            )
          ),
          attestationObject: b64url(attestation),
          transports: ['internal'],
        },
      };
    },

    /** What navigator.credentials.get() returns after the person is verified. */
    assert(options, tweaks = {}) {
      counter += 1;

      const authData = authenticatorData({
        flags: tweaks.flags ?? FLAG_UP | FLAG_UV,
        signCount: tweaks.signCount ?? counter,
        attested: false,
        rpIdForHash: tweaks.rpId,
      });

      const clientDataJSON = clientData(
        tweaks.type ?? 'webauthn.get',
        tweaks.challenge ?? options.challenge,
        tweaks.origin ? { origin: tweaks.origin } : {}
      );

      const signedData = Buffer.concat([authData, sha256(clientDataJSON)]);
      const signingKey = tweaks.privateKey ?? keys.privateKey;
      let signature = crypto.sign('sha256', signedData, signingKey);

      if (tweaks.tamperSignature) {
        signature = Buffer.from(signature);
        signature[signature.length - 1] ^= 0xff;
      }

      return {
        id: tweaks.id ?? b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientDataJSON),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
        },
      };
    },
  };
}
