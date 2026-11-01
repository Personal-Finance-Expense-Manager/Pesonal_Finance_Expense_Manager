/**
 * A minimal, strict CBOR decoder - US-05 (#17), HI-2.
 *
 * WebAuthn wraps the credential public key (a COSE key) and the attestation
 * object in CBOR. Only what those structures use is supported: unsigned and
 * negative integers, byte strings, text strings, arrays, maps with integer or
 * text keys, and true / false / null. Everything else - tags, floats,
 * indefinite lengths, duplicate map keys, nesting deeper than a few levels,
 * lengths that claim more bytes than exist - is rejected, because this decoder
 * reads bytes that arrive from the network.
 */

const MAX_DEPTH = 8;

export class CborError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CborError';
  }
}

function need(buffer, offset, count) {
  if (offset + count > buffer.length) throw new CborError('Truncated CBOR data.');
}

/** Read the argument that follows the initial byte; returns [value, nextOffset]. */
function readArgument(buffer, offset, info) {
  if (info < 24) return [info, offset];

  if (info === 24) {
    need(buffer, offset, 1);
    return [buffer[offset], offset + 1];
  }

  if (info === 25) {
    need(buffer, offset, 2);
    return [buffer.readUInt16BE(offset), offset + 2];
  }

  if (info === 26) {
    need(buffer, offset, 4);
    return [buffer.readUInt32BE(offset), offset + 4];
  }

  if (info === 27) {
    need(buffer, offset, 8);
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError('Integer too large.');
    return [Number(big), offset + 8];
  }

  // 28-30 are reserved and 31 means "indefinite length".
  throw new CborError('Unsupported CBOR length encoding.');
}

function decodeItem(buffer, offset, depth) {
  if (depth > MAX_DEPTH) throw new CborError('CBOR nesting too deep.');
  need(buffer, offset, 1);

  const initial = buffer[offset];
  const major = initial >> 5;
  const info = initial & 0x1f;
  let position = offset + 1;

  if (major === 7) {
    if (info === 20) return [false, position];
    if (info === 21) return [true, position];
    if (info === 22) return [null, position];
    throw new CborError('Unsupported CBOR simple value.');
  }

  if (major === 6) throw new CborError('CBOR tags are not supported.');

  let argument;
  [argument, position] = readArgument(buffer, position, info);

  if (major === 0) return [argument, position];
  if (major === 1) return [-1 - argument, position];

  if (major === 2 || major === 3) {
    need(buffer, position, argument);
    const slice = buffer.subarray(position, position + argument);
    position += argument;

    if (major === 2) return [Buffer.from(slice), position];

    try {
      return [new TextDecoder('utf-8', { fatal: true }).decode(slice), position];
    } catch {
      throw new CborError('Invalid UTF-8 in CBOR text.');
    }
  }

  // Every array element and map entry takes at least one byte, so a count
  // larger than the data that is left can only be a lie.
  if (argument > buffer.length - position) throw new CborError('Truncated CBOR data.');

  if (major === 4) {
    const items = [];
    for (let i = 0; i < argument; i += 1) {
      let item;
      [item, position] = decodeItem(buffer, position, depth + 1);
      items.push(item);
    }
    return [items, position];
  }

  // major === 5: a map
  const map = new Map();
  for (let i = 0; i < argument; i += 1) {
    let key;
    let value;
    [key, position] = decodeItem(buffer, position, depth + 1);

    if (typeof key !== 'number' && typeof key !== 'string') {
      throw new CborError('Unsupported CBOR map key.');
    }

    if (map.has(key)) throw new CborError('Duplicate CBOR map key.');

    [value, position] = decodeItem(buffer, position, depth + 1);
    map.set(key, value);
  }

  return [map, position];
}

/**
 * Decode the first CBOR item at `start`. Returns { value, end } where `end` is
 * the offset just past the item - authenticator data places a COSE key in the
 * middle of a byte string, so the caller needs to know where it stopped.
 */
export function decodeFirst(buffer, start = 0) {
  const [value, end] = decodeItem(buffer, start, 0);
  return { value, end };
}

/** Decode a buffer that must hold exactly one CBOR item. */
export function decode(buffer) {
  const { value, end } = decodeFirst(buffer, 0);
  if (end !== buffer.length) throw new CborError('Unexpected data after the CBOR item.');
  return value;
}
