/**
 * Detector de voz para WAV PCM 16-bit (el formato que graba la app web).
 * Existe porque los modelos de transcripción INVENTAN texto cuando el audio es silencio o ruido
 * (observado con Gemini: 6 min de silencio -> una transcripción completa inventada). Un prompt no alcanza.
 * Devuelve null si el formato no se puede analizar (no se bloquea: solo se omite el chequeo).
 */
export interface SpeechCheck { analyzable: boolean; seconds: number; activeSeconds: number; hasSpeech: boolean }

const WINDOW_MS = 30;
const RMS_THRESHOLD = 0.012;      // ~ -38 dBFS: por debajo es silencio/ruido de fondo muy bajo
const MIN_ACTIVE_SECONDS = 0.6;   // menos que esto de señal no es una frase
const MIN_ACTIVE_RATIO = 0.02;

export function analyzeWav(buf: Buffer): SpeechCheck | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, sampleRate = 0, bits = 0, channels = 0, fmtTag = 0, dataStart = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), len = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { fmtTag = buf.readUInt16LE(off + 8); channels = buf.readUInt16LE(off + 10); sampleRate = buf.readUInt32LE(off + 12); bits = buf.readUInt16LE(off + 22); }
    if (id === 'data') { dataStart = off + 8; dataLen = Math.min(len, buf.length - dataStart); break; }
    off += 8 + len + (len % 2);
  }
  if (dataStart < 0 || fmtTag !== 1 || bits !== 16 || !sampleRate || !channels) return null;

  const frameBytes = 2 * channels, samples = Math.floor(dataLen / frameBytes);
  const win = Math.max(1, Math.floor(sampleRate * WINDOW_MS / 1000));
  let active = 0, windows = 0;
  for (let s = 0; s + win <= samples; s += win) {
    let sum = 0;
    for (let i = 0; i < win; i++) { const v = buf.readInt16LE(dataStart + (s + i) * frameBytes) / 32768; sum += v * v; }
    windows++;
    if (Math.sqrt(sum / win) > RMS_THRESHOLD) active++;
  }
  const seconds = samples / sampleRate, activeSeconds = active * WINDOW_MS / 1000;
  return { analyzable: true, seconds, activeSeconds, hasSpeech: windows > 0 && activeSeconds >= MIN_ACTIVE_SECONDS && active / windows >= MIN_ACTIVE_RATIO };
}
