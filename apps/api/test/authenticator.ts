// Autenticador WebAuthn por software, SOLO para tests. Genera claves P-256 reales y firma de verdad (ES256),
// de modo que se verifica el protocolo completo sin hardware.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

type C = number | string | Buffer | Map<number | string, C>;
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
}
export function cbor(v: C): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

export interface Flags { up?: boolean; uv?: boolean; backup?: boolean }
const flagByte = (f: Flags, at: boolean) => (f.up === false ? 0 : 0x01) | (f.uv === false ? 0 : 0x04) | (at ? 0x40 : 0) | (f.backup === false ? 0 : 0x08 | 0x10);

export class SoftAuthenticator {
  readonly credId = randomBytes(32);
  readonly userHandle: Buffer;
  counter = 0;
  private priv: KeyObject; private x: Buffer; private y: Buffer;
  constructor(public rpID = 'localhost', public origin = 'http://localhost:3000') {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.priv = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.x = Buffer.from(jwk.x, 'base64url'); this.y = Buffer.from(jwk.y, 'base64url');
    this.userHandle = Buffer.alloc(0);
  }
  get id() { return b64u(this.credId); }

  private clientData(type: string, challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** Respuesta a navigator.credentials.create(). `opts.rpID`/`origin`/`flags` permiten simular ataques. */
  register(challenge: string, opts: { origin?: string; rpID?: string; flags?: Flags } = {}) {
    const cose = cbor(new Map<number, C>([[1, 2], [3, -7], [-1, 1], [-2, this.x], [-3, this.y]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([sha256(opts.rpID ?? this.rpID), Buffer.from([flagByte(opts.flags ?? {}, true)]), Buffer.alloc(4), Buffer.alloc(16), len, this.credId, cose]);
    const attestationObject = cbor(new Map<string, C>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: this.id, rawId: this.id, type: 'public-key' as const, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(this.clientData('webauthn.create', challenge, opts.origin)), attestationObject: b64u(attestationObject), transports: ['internal'] },
      clientExtensionResults: {},
    };
  }

  /** Respuesta a navigator.credentials.get(). */
  assert(challenge: string, opts: { origin?: string; rpID?: string; flags?: Flags; counter?: number; corruptSignature?: boolean; signWith?: KeyObject } = {}) {
    this.counter = opts.counter ?? this.counter + 1;
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(opts.rpID ?? this.rpID), Buffer.from([flagByte(opts.flags ?? {}, false)]), cnt]);
    const cd = this.clientData('webauthn.get', challenge, opts.origin);
    let sig = sign('sha256', Buffer.concat([authData, sha256(cd)]), opts.signWith ?? this.priv);
    if (opts.corruptSignature) { sig = Buffer.from(sig); sig[sig.length - 1] = sig[sig.length - 1]! ^ 0xff; }
    return {
      id: this.id, rawId: this.id, type: 'public-key' as const, authenticatorAttachment: 'platform',
      response: { authenticatorData: b64u(authData), clientDataJSON: b64u(cd), signature: b64u(sig), userHandle: b64u(this.userHandle) },
      clientExtensionResults: {},
    };
  }
  static otherKey() { return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey; }
}
