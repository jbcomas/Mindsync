export interface Chunk { text: string; locator: { start: number; end: number; speakers?: string[] } }

const SPEAKER = /^([\p{L}][\p{L}\p{N} .'_-]{0,39}):\s+\S/u;

/**
 * Divide por líneas/párrafos, agrupa hasta `maxChars` y parte lo que sea más largo.
 * Los offsets del locator apuntan al texto original (procedencia, ADR-0002).
 *
 * En transcripciones ("Nombre: texto") NO se corta por hablante: un fragmento puede contener varios turnos
 * para que el extractor vea la conversación completa (p. ej. una duda de Luis sobre una idea de Ana) y atribuya
 * cada item a quien lo dijo. El locator lista los hablantes presentes.
 */
export function chunkText(text: string, maxChars = 1500): Chunk[] {
  const units: { text: string; start: number; speaker?: string }[] = [];
  const re = /[^\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0].trim()) continue;
    units.push({ text: m[0], start: m.index, speaker: SPEAKER.exec(m[0])?.[1]?.trim() });
  }
  const out: Chunk[] = [];
  let cur: { text: string; start: number; end: number; speakers: Set<string> } | null = null;
  const flush = () => {
    if (!cur) return;
    out.push({ text: cur.text, locator: { start: cur.start, end: cur.end, ...(cur.speakers.size && { speakers: [...cur.speakers] }) } });
    cur = null;
  };

  for (const u of units) {
    for (const piece of splitLong(u.text, maxChars)) {
      const start = u.start + piece.offset;
      // Une con el texto original (incluidos los saltos de línea entre unidades).
      if (cur && text.slice(cur.start, start + piece.text.length).length <= maxChars) {
        cur.text = text.slice(cur.start, start + piece.text.length);
        cur.end = start + piece.text.length;
        if (u.speaker) cur.speakers.add(u.speaker);
      } else {
        flush();
        cur = { text: piece.text, start, end: start + piece.text.length, speakers: new Set(u.speaker ? [u.speaker] : []) };
      }
    }
  }
  flush();
  return out;
}

function splitLong(s: string, max: number): { text: string; offset: number }[] {
  if (s.length <= max) return [{ text: s, offset: 0 }];
  const parts: { text: string; offset: number }[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + max, s.length);
    if (end < s.length) {
      const cut = s.lastIndexOf('. ', end);
      if (cut > i + max * 0.5) end = cut + 1;
    }
    parts.push({ text: s.slice(i, end), offset: i });
    i = end;
    while (s[i] === ' ') i++;
  }
  return parts;
}
