import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decode, decodeFirst, CborError } from '../src/utils/cbor.js';
import {
  WebAuthnError,
  buildAuthenticationOptions,
  buildRegistrationOptions,
  fromBase64Url,
  newChallenge,
  relyingParty,
  verifyAssertion,
  verifyRegistration,
} from '../src/services/webauthnService.js';
import {
  FLAG_AT,
  FLAG_UP,
  FLAG_UV,
  createSoftAuthenticator,
  encodeCbor,
} from './helpers/softAuthenticator.js';

/**
 * US-05 (#17), HI-2: the server half of the device biometric unlock.
 *
 * The "device" is a software authenticator that makes genuine WebAuthn
 * messages, so these tests exercise the real verification. They also pin down
 * what must be REFUSED: a wrong challenge, a wrong origin, a person who was not
 * verified on the device, a forged or replayed signature.
 */

const rp = { id: 'localhost', name: 'PFEM', origin: 'http://localhost:5173' };
const hex = (text) => Buffer.from(text.replace(/\s/g, ''), 'hex');

describe('CBOR decoder', () => {
  // Vectors from RFC 8949 Appendix A.
  const vectors = [
    ['00', 0],
    ['17', 23],
    ['1818', 24],
    ['1864', 100],
    ['1903e8', 1000],
    ['1a000f4240', 1000000],
    ['20', -1],
    ['3863', -100],
    ['f4', false],
    ['f5', true],
    ['f6', null],
    ['6449455446', 'IETF'],
  ];

  for (const [bytes, expected] of vectors) {
    test(`decodes ${bytes}`, () => {
      assert.equal(decode(hex(bytes)), expected);
    });
  }

  test('decodes a byte string, an array and a map with integer keys', () => {
    assert.deepEqual(decode(hex('4401020304')), Buffer.from([1, 2, 3, 4]));
    assert.deepEqual(decode(hex('83010203')), [1, 2, 3]);

    const map = decode(hex('a201020304'));
    assert.ok(map instanceof Map);
    assert.equal(map.get(1), 2);
    assert.equal(map.get(3), 4);
  });

  test('reports where the first item ended, for a key inside authenticator data', () => {
    const { value, end } = decodeFirst(hex('83010203ffff'));
    assert.deepEqual(value, [1, 2, 3]);
    assert.equal(end, 4);
  });

  test('round-trips what the test authenticator encodes', () => {
    const original = new Map([
      [1, 2],
      [-1, 1],
      ['fmt', 'none'],
      [-2, Buffer.alloc(32, 7)],
      ['list', [1, -5, 'x']],
    ]);

    const decoded = decode(encodeCbor(original));
    assert.deepEqual([...decoded.entries()], [...original.entries()]);
  });

  const malformed = {
    'truncated integer': '19',
    'truncated byte string': '4401',
    'trailing bytes': '0000',
    'indefinite-length array': '9f0102ff',
    'indefinite-length byte string': '5f4101ff',
    'a tag': 'c11a514b67b0',
    'a float': 'fb3ff199999999999a',
    'duplicate map keys': 'a201020103',
    'a byte-string map key': 'a1410102',
    'a map claiming more entries than there is data': 'b903e8',
    'an array claiming a huge length': '9b00ffffffffffffff',
    'invalid UTF-8': '62c328',
    'empty input': '',
  };

  for (const [name, bytes] of Object.entries(malformed)) {
    test(`rejects ${name}`, () => {
      assert.throws(() => decode(hex(bytes)), CborError);
    });
  }

  test('rejects nesting that is too deep', () => {
    assert.throws(() => decode(Buffer.concat([Buffer.alloc(20, 0x81), Buffer.from([0])])), CborError);
  });
});

describe('relying party', () => {
  test('is derived from the client origin', () => {
    const party = relyingParty({ CLIENT_ORIGIN: 'https://pfem.example.com/some/path' });
    assert.equal(party.id, 'pfem.example.com');
    assert.equal(party.origin, 'https://pfem.example.com');
  });

  test('explicit settings win, and a wildcard CORS origin falls back to the dev client', () => {
    assert.deepEqual(
      relyingParty({ WEBAUTHN_ORIGIN: 'https://app.example.com', WEBAUTHN_RP_ID: 'example.com' }),
      { id: 'example.com', name: 'Personal Finance Expense Manager', origin: 'https://app.example.com' }
    );
    assert.equal(relyingParty({ CLIENT_ORIGIN: '*' }).origin, 'http://localhost:5173');
    assert.equal(relyingParty({}).id, 'localhost');
  });
});

describe('options sent to the browser', () => {
  test('registration asks for the device sensor, with the person verified, and no attestation', () => {
    const options = buildRegistrationOptions({
      user: { _id: '64b7f0f2a1b2c3d4e5f60718', email: 'a@example.test', name: 'A' },
      challenge: newChallenge(),
      rp,
      existing: [{ credential_id: 'abc', transports: ['internal'] }],
    });

    assert.equal(options.authenticatorSelection.authenticatorAttachment, 'platform');
    assert.equal(options.authenticatorSelection.userVerification, 'required');
    assert.equal(options.attestation, 'none');
    assert.equal(options.rp.id, 'localhost');
    assert.deepEqual(options.excludeCredentials.map((c) => c.id), ['abc']);
    // The handle is opaque: not the e-mail address and not the plain id text.
    assert.equal(fromBase64Url(options.user.id).length, 12);
    assert.ok(options.pubKeyCredParams.some((p) => p.alg === -7));
  });

  test('authentication requires user verification and lists only enrolled credentials', () => {
    const options = buildAuthenticationOptions({
      challenge: newChallenge(),
      rp,
      credentials: [{ credential_id: 'abc', transports: [] }],
    });

    assert.equal(options.userVerification, 'required');
    assert.equal(options.rpId, 'localhost');
    assert.deepEqual(options.allowCredentials.map((c) => c.id), ['abc']);
  });

  test('every challenge is fresh', () => {
    const seen = new Set(Array.from({ length: 50 }, newChallenge));
    assert.equal(seen.size, 50);
    assert.equal(fromBase64Url([...seen][0]).length, 32);
  });
});

for (const algorithm of ['ES256', 'RS256']) {
  describe(`registration and assertion (${algorithm})`, () => {
    function enrol(tweaks = {}) {
      const device = createSoftAuthenticator({ rpId: rp.id, origin: rp.origin, algorithm });
      const challenge = newChallenge();
      const credential = device.register({ challenge }, tweaks);
      return { device, challenge, credential };
    }

    function enrolled() {
      const { device, challenge, credential } = enrol();
      const verified = verifyRegistration({ credential, challenge, rp });
      return { device, stored: { publicKey: verified.publicKey, signCount: verified.signCount }, verified };
    }

    function reason(fn) {
      try {
        fn();
      } catch (error) {
        assert.ok(error instanceof WebAuthnError, `expected WebAuthnError, got ${error}`);
        return error.reason;
      }
      assert.fail('expected the verification to be refused');
    }

    test('accepts a genuine registration and returns the public key to store', () => {
      const { device, challenge, credential } = enrol();
      const result = verifyRegistration({ credential, challenge, rp });

      assert.equal(result.credentialId, device.id);
      assert.equal(result.signCount, 0);
      assert.deepEqual(result.transports, ['internal']);

      // Only the PUBLIC key comes back, and it is the device's.
      const key = crypto.createPublicKey({ key: Buffer.from(result.publicKey, 'base64'), format: 'der', type: 'spki' });
      assert.equal(key.type, 'public');
      assert.equal(
        key.export({ format: 'jwk' }).kty,
        device.publicKey.export({ format: 'jwk' }).kty
      );
    });

    test('accepts a genuine assertion and returns the new counter', () => {
      const { device, stored } = enrolled();
      const challenge = newChallenge();
      const result = verifyAssertion({ credential: device.assert({ challenge }), challenge, rp, stored });

      assert.equal(result.signCount, 1);
    });

    test('refuses a registration answering a different challenge', () => {
      const { device } = enrol();
      const credential = device.register({ challenge: newChallenge() });

      assert.equal(reason(() => verifyRegistration({ credential, challenge: newChallenge(), rp })), 'challenge_mismatch');
    });

    test('refuses a registration from another origin', () => {
      const { challenge, credential } = enrol({ origin: 'https://evil.example' });

      assert.equal(reason(() => verifyRegistration({ credential, challenge, rp })), 'origin_mismatch');
    });

    test('refuses a registration bound to another relying party id', () => {
      const { challenge, credential } = enrol({ rpId: 'evil.example' });

      assert.equal(reason(() => verifyRegistration({ credential, challenge, rp })), 'rp_id_mismatch');
    });

    test('refuses a registration where the person was not verified on the device', () => {
      const { challenge, credential } = enrol({ flags: FLAG_UP | FLAG_AT });

      assert.equal(reason(() => verifyRegistration({ credential, challenge, rp })), 'user_not_verified');
    });

    test('refuses a registration with no user presence', () => {
      const { challenge, credential } = enrol({ flags: FLAG_UV | FLAG_AT });

      assert.equal(reason(() => verifyRegistration({ credential, challenge, rp })), 'user_not_present');
    });

    test('refuses a registration without credential data', () => {
      const { challenge, credential } = enrol({ flags: FLAG_UP | FLAG_UV });

      assert.equal(reason(() => verifyRegistration({ credential, challenge, rp })), 'no_credential_data');
    });

    test('refuses a registration whose clientData is not a create ceremony', () => {
      const { challenge, credential } = enrol({ type: 'webauthn.get' });

      assert.equal(reason(() => verifyRegistration({ credential, challenge, rp })), 'client_data_type');
    });

    test('refuses a credential id that differs from the one inside the authenticator data', () => {
      const { challenge, credential } = enrol({ id: crypto.randomBytes(32).toString('base64url') });

      assert.equal(reason(() => verifyRegistration({ credential, challenge, rp })), 'credential_id_mismatch');
    });

    test('refuses a garbage attestation object', () => {
      const { challenge, credential } = enrol();
      credential.response.attestationObject = Buffer.from('not cbor at all').toString('base64url');

      assert.ok(reason(() => verifyRegistration({ credential, challenge, rp })));
    });

    test('refuses an assertion with a replaced or wrong challenge', () => {
      const { device, stored } = enrolled();
      const credential = device.assert({ challenge: newChallenge() });

      assert.equal(reason(() => verifyAssertion({ credential, challenge: newChallenge(), rp, stored })), 'challenge_mismatch');
    });

    test('refuses an assertion from another origin', () => {
      const { device, stored } = enrolled();
      const challenge = newChallenge();

      assert.equal(
        reason(() => verifyAssertion({ credential: device.assert({ challenge }, { origin: 'https://evil.example' }), challenge, rp, stored })),
        'origin_mismatch'
      );
    });

    test('refuses an assertion where the person was not verified on the device', () => {
      const { device, stored } = enrolled();
      const challenge = newChallenge();

      assert.equal(
        reason(() => verifyAssertion({ credential: device.assert({ challenge }, { flags: FLAG_UP }), challenge, rp, stored })),
        'user_not_verified'
      );
    });

    test('refuses a tampered signature', () => {
      const { device, stored } = enrolled();
      const challenge = newChallenge();

      assert.equal(
        reason(() => verifyAssertion({ credential: device.assert({ challenge }, { tamperSignature: true }), challenge, rp, stored })),
        'bad_signature'
      );
    });

    test('refuses a signature made by a different key', () => {
      const { device, stored } = enrolled();
      const attacker = crypto.generateKeyPairSync(algorithm === 'RS256' ? 'rsa' : 'ec', algorithm === 'RS256' ? { modulusLength: 2048 } : { namedCurve: 'P-256' });
      const challenge = newChallenge();

      assert.equal(
        reason(() => verifyAssertion({ credential: device.assert({ challenge }, { privateKey: attacker.privateKey }), challenge, rp, stored })),
        'bad_signature'
      );
    });

    test('refuses a counter that does not move forward (a cloned authenticator)', () => {
      const { device, stored } = enrolled();
      const first = newChallenge();
      const { signCount } = verifyAssertion({ credential: device.assert({ challenge: first }, { signCount: 5 }), challenge: first, rp, stored });
      assert.equal(signCount, 5);

      const second = newChallenge();
      assert.equal(
        reason(() => verifyAssertion({ credential: device.assert({ challenge: second }, { signCount: 5 }), challenge: second, rp, stored: { ...stored, signCount: 5 } })),
        'sign_count_regressed'
      );
    });

    test('allows authenticators that always report a zero counter', () => {
      const { device, stored } = enrolled();

      for (let i = 0; i < 2; i += 1) {
        const challenge = newChallenge();
        const result = verifyAssertion({ credential: device.assert({ challenge }, { signCount: 0 }), challenge, rp, stored });
        assert.equal(result.signCount, 0);
      }
    });

    test('refuses an assertion that is not a well-formed credential', () => {
      const { stored } = enrolled();

      for (const credential of [null, {}, { id: 'x', type: 'password', response: {} }, { id: 'x', type: 'public-key', response: { signature: 5 } }]) {
        assert.ok(reason(() => verifyAssertion({ credential, challenge: newChallenge(), rp, stored })));
      }
    });
  });
}

describe('algorithms and keys the server does not accept', () => {
  test('rejects an unsupported COSE algorithm', () => {
    const device = createSoftAuthenticator({ rpId: rp.id, origin: rp.origin });
    const challenge = newChallenge();
    const cose = new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.alloc(32)]]); // Ed25519
    const credential = device.register({ challenge }, { cose });

    assert.throws(() => verifyRegistration({ credential, challenge, rp }), (e) => e.reason === 'unsupported_algorithm');
  });

  test('rejects a P-256 point that is not on the curve', () => {
    const device = createSoftAuthenticator({ rpId: rp.id, origin: rp.origin });
    const challenge = newChallenge();
    const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)], [-3, Buffer.alloc(32, 2)]]);
    const credential = device.register({ challenge }, { cose });

    assert.throws(() => verifyRegistration({ credential, challenge, rp }), (e) => e.reason === 'cose_key');
  });

  test('rejects an RSA key shorter than 2048 bits', () => {
    const device = createSoftAuthenticator({ rpId: rp.id, origin: rp.origin });
    const challenge = newChallenge();
    const small = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' });
    const cose = new Map([[1, 3], [3, -257], [-1, Buffer.from(small.n, 'base64url')], [-2, Buffer.from(small.e, 'base64url')]]);
    const credential = device.register({ challenge }, { cose });

    assert.throws(() => verifyRegistration({ credential, challenge, rp }), (e) => e.reason === 'cose_key');
  });

  test('base64url input is validated strictly', () => {
    for (const bad of ['a+b', 'a/b', 'a=', 'a b', 5, null, 'abcde']) {
      assert.throws(() => fromBase64Url(bad), WebAuthnError);
    }
    assert.deepEqual(fromBase64Url('AQID'), Buffer.from([1, 2, 3]));
  });
});
