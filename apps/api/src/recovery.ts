import { createHash, randomInt } from 'node:crypto';

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L): 31 símbolos x 16 posiciones ≈ 79 bits de entropía.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODES_PER_SET = 8;

export function generateCode(): string {
  const raw = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return raw.match(/.{4}/g)!.join('-');
}
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** El código tiene entropía alta, así que sha256 es suficiente (no es una contraseña elegida por una persona). */
export const hashCode = (c: string) => createHash('sha256').update(normalizeCode(c)).digest('hex');
export function newCodeSet(n = CODES_PER_SET) { const codes = Array.from({ length: n }, generateCode); return { codes, hashes: codes.map(hashCode) }; }
