import { describe, expect, it } from 'vitest';
import { analyzeWav } from '../src/audio.js';

export function wav(seconds: number, opts: { hz?: number; amp?: number; sr?: number; noise?: number; from?: number; to?: number } = {}) {
  const sr = opts.sr ?? 16000, n = Math.floor(sr * seconds), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr, inBand = t >= (opts.from ?? 0) && t < (opts.to ?? Infinity);
    let v = opts.noise ? (Math.random() * 2 - 1) * opts.noise : 0;
    if (opts.hz && inBand) v += (opts.amp ?? 0.2) * Math.sin(2 * Math.PI * opts.hz * t);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf;
}

describe('analyzeWav (detector de voz)', () => {
  it('silencio puro NO tiene voz (el caso que hizo alucinar a Gemini)', () => {
    expect(analyzeWav(wav(390))).toMatchObject({ analyzable: true, hasSpeech: false, activeSeconds: 0 });
  });
  it('ruido de fondo muy bajo NO tiene voz', () => {
    expect(analyzeWav(wav(30, { noise: 0.005 }))!.hasSpeech).toBe(false);
  });
  it('una señal sostenida SÍ cuenta como actividad', () => {
    const r = analyzeWav(wav(10, { hz: 220, amp: 0.2 }))!;
    expect(r.hasSpeech).toBe(true);
    expect(r.activeSeconds).toBeGreaterThan(9);
  });
  it('un golpe/clic corto NO alcanza', () => {
    expect(analyzeWav(wav(60, { hz: 300, amp: 0.5, from: 1, to: 1.2 }))!.hasSpeech).toBe(false);
  });
  it('voz en una parte de una grabación larga SÍ se detecta', () => {
    expect(analyzeWav(wav(300, { hz: 200, amp: 0.15, from: 100, to: 130 }))!.hasSpeech).toBe(true);
  });
  it('formatos que no analiza devuelven null (no se bloquea)', () => {
    expect(analyzeWav(Buffer.alloc(5000, 7))).toBeNull();
    expect(analyzeWav(Buffer.from('ID3'))).toBeNull();
  });
});
