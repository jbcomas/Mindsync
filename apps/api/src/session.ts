import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 30 * 24 * 3600 * 1000;
const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

/** Cookie de sesión firmada: `userId.expiraMs.hmac`. */
export function makeSession(secret: string, userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + TTL_MS}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function readSession(secret: string, cookieHeader: string | undefined, now = Date.now()): string | null {
  const raw = cookieHeader?.split(';').map(s => s.trim()).find(s => s.startsWith('ms_session='))?.slice('ms_session='.length);
  if (!raw) return null;
  const [userId, exp, mac] = raw.split('.');
  if (!userId || !exp || !mac) return null;
  const expected = sign(secret, `${userId}.${exp}`);
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) < now) return null;
  return /^[0-9a-f-]{36}$/i.test(userId) ? userId : null;
}

// ---- Blob firmado de corta vida (challenge de WebAuthn). Va en una cookie HttpOnly; el servidor no guarda estado.
export function signBlob(secret: string, data: Record<string, unknown>, ttlMs: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...data, x: now + ttlMs })).toString('base64url');
  return `${body}.${sign(secret, `blob.${body}`)}`;
}

export function readBlob<T extends Record<string, unknown>>(secret: string, cookieHeader: string | undefined, name: string, now = Date.now()): (T & { x: number }) | null {
  const raw = cookieHeader?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return null;
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const a = Buffer.from(mac), b = Buffer.from(sign(secret, `blob.${body}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof v.x === 'number' && v.x >= now ? v : null;
  } catch { return null; }
}
