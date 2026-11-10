/**
 * Puntaje determinístico de la extracción (sin modelo juez: reproducible y gratis).
 * Cada caso define items ESPERADOS (anclados a una frase del texto), items PERMITIDOS (extras aceptables) y items PROHIBIDOS (trampas).
 */
/** Otra frase del texto que respalda el MISMO item (p. ej. el pedido y la aceptación de una tarea), con su propio hablante. */
export interface Alt { anchor: string; speaker?: string }
export interface Expected { id: string; type: string[]; anchor: string; alts?: Alt[]; speaker?: string; epistemic?: string[]; /** AND de OR: cada grupo exige al menos una de sus cadenas en título+cuerpo. */ mustContain?: string[][] }
export interface Forbidden { anchor: string; types?: string[]; why: string }
export interface ExpectedRelation { from: string; to: string; kinds?: string[] }
export interface Case {
  id: string; split: 'dev' | 'test'; kind: 'meeting' | 'note'; note: string;
  text: string; expected: Expected[]; allowed?: string[]; forbidden?: Forbidden[]; forbiddenText?: RegExp[];
  relations?: ExpectedRelation[]; maxItems?: number;
}
export interface Item { type: string; title: string; body?: string; epistemic_status: string; speaker?: string; quote: string; confidence?: number }
export interface Rel { from: number; to: number; kind: string }
export interface Extracted { items: Item[]; relations: Rel[]; droppedQuotes: number }

export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}@. ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const toks = (s: string) => new Set(norm(s).split(' ').filter(w => w.length >= 3 || /\d/.test(w)));

/** Fracción de las palabras del ancla que aparecen en la cita (0..1). Contener el ancla completa da 1. */
export function coverage(quote: string, anchor: string): number {
  if (norm(quote).includes(norm(anchor))) return 1;
  const a = toks(anchor), q = toks(quote);
  if (!a.size) return 0;
  let hit = 0; for (const t of a) if (q.has(t)) hit++;
  return hit / a.size;
}
const MATCH_MIN = 0.6;

export interface CaseScore {
  caseId: string; nExpected: number; nExtracted: number;
  found: number; typeOk: number; speakerOk: number; speakerN: number; epistemicOk: number; epistemicN: number; contentOk: number; contentN: number; full: number;
  missed: string[]; wrongType: string[]; wrongSpeaker: string[]; wrongEpistemic: string[]; wrongContent: string[];
  extras: string[]; violations: string[]; relFound: number; relN: number; droppedQuotes: number;
}

export function scoreCase(c: Case, out: Extracted): CaseScore {
  const { items } = out;
  // Asignación uno a uno esperado<->extraído por mayor cobertura del ancla.
  const pairs: { e: number; x: number; cov: number; speaker?: string }[] = [];
  c.expected.forEach((exp, e) => items.forEach((it, x) => {
    // El item puede respaldarse en el ancla principal o en cualquiera de sus alternativas; se queda con la que mejor cubre.
    let best = { cov: coverage(it.quote, exp.anchor), speaker: exp.speaker };
    for (const a of exp.alts ?? []) { const cov = coverage(it.quote, a.anchor); if (cov > best.cov) best = { cov, speaker: a.speaker ?? exp.speaker }; }
    if (best.cov >= MATCH_MIN) pairs.push({ e, x, cov: best.cov, speaker: best.speaker });
  }));
  pairs.sort((a, b) => b.cov - a.cov);
  const byExp = new Map<number, number>(), usedX = new Set<number>(), spk = new Map<number, string | undefined>();
  for (const p of pairs) if (!byExp.has(p.e) && !usedX.has(p.x)) { byExp.set(p.e, p.x); usedX.add(p.x); spk.set(p.e, p.speaker); }

  const s: CaseScore = { caseId: c.id, nExpected: c.expected.length, nExtracted: items.length, found: 0, typeOk: 0, speakerOk: 0, speakerN: 0, epistemicOk: 0, epistemicN: 0, contentOk: 0, contentN: 0, full: 0,
    missed: [], wrongType: [], wrongSpeaker: [], wrongEpistemic: [], wrongContent: [], extras: [], violations: [], relFound: 0, relN: 0, droppedQuotes: out.droppedQuotes };

  c.expected.forEach((exp, e) => {
    const x = byExp.get(e);
    if (x === undefined) { s.missed.push(`${exp.id}: «${exp.anchor}»`); return; }
    const it = items[x]!; s.found++;
    const tOk = exp.type.includes(it.type); if (tOk) s.typeOk++; else s.wrongType.push(`${exp.id}: esperado ${exp.type.join('|')}, salió ${it.type} («${it.title}»)`);
    let all = tOk;
    const want = spk.get(e);   // el hablante de la frase por la que se encontró (principal o alternativa)
    if (want) { s.speakerN++; const ok = !!it.speaker && norm(it.speaker) === norm(want); if (ok) s.speakerOk++; else { all = false; s.wrongSpeaker.push(`${exp.id}: esperado ${want}, salió ${it.speaker ?? '(vacío)'}`); } }
    if (exp.epistemic) { s.epistemicN++; const ok = exp.epistemic.includes(it.epistemic_status); if (ok) s.epistemicOk++; else { all = false; s.wrongEpistemic.push(`${exp.id}: esperado ${exp.epistemic.join('|')}, salió ${it.epistemic_status}`); } }
    if (exp.mustContain) {
      s.contentN++; const hay = norm(`${it.title} ${it.body ?? ''}`);
      const ok = exp.mustContain.every(g => g.some(w => hay.includes(norm(w))));
      if (ok) s.contentOk++; else { all = false; s.wrongContent.push(`${exp.id}: faltan ${JSON.stringify(exp.mustContain)} en «${it.title}${it.body ? ' — ' + it.body : ''}»`); }
    }
    if (all) s.full++;
  });

  // Extras: items sin pareja que no están permitidos.
  items.forEach((it, x) => {
    if (usedX.has(x)) return;
    const hay = norm(`${it.title} ${it.quote}`);
    if ((c.allowed ?? []).some(a => hay.includes(norm(a)))) return;
    s.extras.push(`[${it.type}] ${it.title}  ← «${it.quote}»`);
  });

  // Trampas.
  for (const f of c.forbidden ?? []) for (const it of items)
    if (coverage(it.quote, f.anchor) >= MATCH_MIN && (!f.types || f.types.includes(it.type))) s.violations.push(`${f.why}: [${it.type}] ${it.title}`);
  for (const re of c.forbiddenText ?? []) for (const it of items)
    if (re.test(`${it.title} ${it.body ?? ''} ${it.quote}`)) s.violations.push(`texto prohibido ${re}: [${it.type}] ${it.title}`);
  if (c.maxItems !== undefined && items.length > c.maxItems) s.violations.push(`máximo ${c.maxItems} items, salieron ${items.length}`);

  // Relaciones esperadas entre items esperados ya encontrados.
  const idx = new Map(c.expected.map((e, i) => [e.id, byExp.get(i)]));
  for (const r of c.relations ?? []) {
    s.relN++;
    const a = idx.get(r.from), b = idx.get(r.to);
    if (a === undefined || b === undefined) continue;
    if (out.relations.some(x => ((x.from === a && x.to === b) || (x.from === b && x.to === a)) && (!r.kinds || r.kinds.includes(x.kind)))) s.relFound++;
  }
  return s;
}

export interface Aggregate {
  cases: number; expected: number; extracted: number; recall: number; fullRate: number; typeAcc: number; speakerAcc: number; epistemicAcc: number; contentAcc: number;
  noiseRate: number; violations: number; relRecall: number; droppedQuoteRate: number;
}
const ratio = (a: number, b: number) => (b ? a / b : 1);
export function aggregate(scores: CaseScore[]): Aggregate {
  const sum = (f: (s: CaseScore) => number) => scores.reduce((t, s) => t + f(s), 0);
  const found = sum(s => s.found), extracted = sum(s => s.nExtracted);
  return {
    cases: scores.length, expected: sum(s => s.nExpected), extracted,
    recall: ratio(found, sum(s => s.nExpected)), fullRate: ratio(sum(s => s.full), sum(s => s.nExpected)),
    typeAcc: ratio(sum(s => s.typeOk), found), speakerAcc: ratio(sum(s => s.speakerOk), sum(s => s.speakerN)),
    epistemicAcc: ratio(sum(s => s.epistemicOk), sum(s => s.epistemicN)), contentAcc: ratio(sum(s => s.contentOk), sum(s => s.contentN)),
    noiseRate: ratio(sum(s => s.extras.length), extracted), violations: sum(s => s.violations.length),
    relRecall: ratio(sum(s => s.relFound), sum(s => s.relN)), droppedQuoteRate: ratio(sum(s => s.droppedQuotes), extracted + sum(s => s.droppedQuotes)),
  };
}
