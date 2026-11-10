import { aggregate, scoreCase, type Aggregate, type Case, type CaseScore, type Extracted } from './score.js';

export interface RunRecord {
  model: string; prompt: string; caseId: string; rep: number;
  extracted: Extracted | null; error?: string; inputTokens: number; outputTokens: number; latencyMs: number; calls: number;
}
export interface RunFile { label: string; createdAt: string; promptVariant: string; models: string[]; records: RunRecord[] }

/** USD por millón de tokens [entrada, salida]. Solo los precios que están verificados; el resto se informa como "n/d". */
export const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-opus-5-5': [4, 20],
};
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function scoreRun(file: RunFile, cases: Case[], split: 'dev' | 'test' | 'all') {
  const byId = new Map(cases.map(c => [c.id, c]));
  const out: Record<string, { scores: CaseScore[]; agg: Aggregate; failures: number; inTok: number; outTok: number; latency: number; n: number; cost: number | null; records: RunRecord[] }> = {};
  for (const model of file.models) {
    const recs = file.records.filter(r => r.model === model && (split === 'all' || byId.get(r.caseId)?.split === split));
    const scores = recs.map(r => scoreCase(byId.get(r.caseId)!, r.extracted ?? { items: [], relations: [], droppedQuotes: 0 }));
    const inTok = recs.reduce((s, r) => s + r.inputTokens, 0), outTok = recs.reduce((s, r) => s + r.outputTokens, 0);
    const price = PRICES[model.split(':')[1] ?? ''];
    out[model] = {
      scores, agg: aggregate(scores), failures: recs.filter(r => !r.extracted).length, inTok, outTok, n: recs.length,
      latency: recs.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, recs.length), cost: price ? (inTok * price[0] + outTok * price[1]) / 1e6 : null, records: recs,
    };
  }
  return out;
}

export function renderReport(file: RunFile, cases: Case[], split: 'dev' | 'test' | 'all', detail = true): string {
  const res = scoreRun(file, cases, split);
  const L: string[] = [];
  L.push(`# Evaluación de extracción — ${file.label}`, '', `- Prompt: **${file.promptVariant}** · casos: **${split}** · ${file.createdAt}`,
    '- Los casos los escribí yo (no son reuniones reales): sirven para comparar, no para predecir el rendimiento con tus reuniones.', '');
  L.push('| modelo | recall | completos* | tipo | hablante | estado epist. | contenido | ruido** | violaciones | relaciones | citas inventadas | fallos | tokens ent/sal | USD | ms/llamada |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of file.models) {
    const r = res[m]!, a = r.agg;
    L.push(`| ${m} | ${pct(a.recall)} | **${pct(a.fullRate)}** | ${pct(a.typeAcc)} | ${pct(a.speakerAcc)} | ${pct(a.epistemicAcc)} | ${pct(a.contentAcc)} | ${pct(a.noiseRate)} | **${a.violations}** | ${pct(a.relRecall)} | ${pct(a.droppedQuoteRate)} | ${r.failures}/${r.n} | ${r.inTok}/${r.outTok} | ${r.cost === null ? 'n/d' : '$' + r.cost.toFixed(3)} | ${r.latency.toFixed(0)} |`);
  }
  L.push('', '\\* *completo* = encontrado con la cita correcta Y tipo, hablante, estado epistémico y contenido correctos. ** *ruido* = items extraídos que no estaban esperados ni permitidos (puede incluir items válidos que no etiqueté: revisar la lista).', '');
  if (!detail) return L.join('\n');
  for (const m of file.models) {
    const r = res[m]!; L.push(`## ${m}`, '');
    const sum = (k: 'missed' | 'wrongType' | 'wrongSpeaker' | 'wrongEpistemic' | 'wrongContent' | 'extras' | 'violations') => r.scores.reduce((n, s) => n + s[k].length, 0);
    L.push(`Faltantes ${sum('missed')} · tipo ${sum('wrongType')} · hablante ${sum('wrongSpeaker')} · estado ${sum('wrongEpistemic')} · contenido ${sum('wrongContent')} · extras ${sum('extras')} · **violaciones ${sum('violations')}**`, '');
    const err = r.records.filter(x => !x.extracted); if (err.length) L.push(`Fallos de llamada: ${err.map(x => `${x.caseId} (${x.error})`).join(', ')}`, '');
    for (const s of r.scores) {
      const lines = [...s.violations.map(v => `🚫 VIOLACIÓN ${v}`), ...s.missed.map(v => `❌ falta ${v}`), ...s.wrongType.map(v => `⚠ tipo ${v}`), ...s.wrongSpeaker.map(v => `⚠ hablante ${v}`),
        ...s.wrongEpistemic.map(v => `⚠ estado ${v}`), ...s.wrongContent.map(v => `⚠ contenido ${v}`), ...s.extras.map(v => `➕ extra ${v}`)];
      if (lines.length) L.push(`**${s.caseId}** — ${s.full}/${s.nExpected} completos, ${s.nExtracted} extraídos`, ...lines.map(l => `- ${l}`), '');
    }
  }
  return L.join('\n');
}
