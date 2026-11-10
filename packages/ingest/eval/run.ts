// Ejecuta la evaluación contra los modelos REALES (gasta dinero). Uso:
//   npx tsx --env-file=../../.env eval/run.ts --models anthropic:claude-sonnet-5-5,gemini:gemini-3.5-flash-lite --split dev --prompt v1 --label baseline
// Guarda la salida cruda en eval/results/<label>.json (se puede re-puntuar sin gastar: eval/rescore.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anthropicProvider, createGateway, geminiProvider, type CallRecord } from '@mindsync/llm';
import { chunkText } from '../src/chunk.js';
import { extractChunk } from '../src/extract.js';
import { CASES } from './cases.js';
import { PROMPTS } from './prompts.js';
import { renderReport, type RunFile, type RunRecord } from './report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const models = (arg('models') ?? '').split(',').filter(Boolean);
const split = (arg('split', 'dev') as 'dev' | 'test' | 'all');
const variant = arg('prompt', 'v1')!, label = arg('label', `${variant}-${Date.now()}`)!, reps = Number(arg('reps', '1'));
const only = arg('cases')?.split(',');
const concurrency = Number(arg('concurrency', '3'));
if (!models.length) { console.error('Falta --models provider:model[,...]'); process.exit(1); }
if (!PROMPTS[variant]) { console.error(`Prompt desconocido: ${variant}. Disponibles: ${Object.keys(PROMPTS).join(', ')}`); process.exit(1); }
if (split === 'test' && !process.argv.includes('--final')) { console.error('Los casos "test" son la reserva: solo se miran al final, con --final.'); process.exit(1); }

const cases = CASES.filter(c => (split === 'all' || c.split === split) && (!only || only.includes(c.id)));

function gatewayFor(spec: string) {
  const [prov, model] = spec.split(':') as [string, string];
  const providers = { anthropic: process.env.ANTHROPIC_API_KEY ? anthropicProvider() : undefined, gemini: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ? geminiProvider() : undefined };
  const p = providers[prov as 'anthropic' | 'gemini'];
  if (!p) throw new Error(`Sin credenciales para ${prov}`);
  const route = [{ provider: prov, model }];
  const calls: CallRecord[] = [];
  const gw = createGateway({
    providers: { [prov]: p }, routes: { classify: route, extract: route, relate: route, ideate: route, write: route },
    embedding: { provider: prov, model: 'unused', dimensions: 1024 }, timeoutMs: 120_000, maxAttempts: 2, onCall: r => { calls.push(r); },
  });
  return { gw, calls };
}

async function runOne(spec: string, c: (typeof cases)[number], rep: number): Promise<RunRecord> {
  const { gw, calls } = gatewayFor(spec);
  const t0 = Date.now();
  try {
    const items: any[] = [], relations: any[] = []; let dropped = 0;
    for (const ch of chunkText(c.text)) {
      const r = await extractChunk(gw, { text: ch.text, dataClass: 'personal', system: PROMPTS[variant] });
      const off = items.length;
      items.push(...r.items); relations.push(...r.relations.map(x => ({ ...x, from: x.from + off, to: x.to + off }))); dropped += r.droppedQuotes;
    }
    return rec(spec, c.id, rep, { items, relations, droppedQuotes: dropped });
  } catch (e) { return rec(spec, c.id, rep, null, (e as { kind?: string }).kind ?? (e as Error).name); }
  function rec(model: string, caseId: string, rp: number, extracted: any, error?: string): RunRecord {
    return { model, prompt: variant, caseId, rep: rp, extracted, error, inputTokens: calls.reduce((s, x) => s + (x.inputTokens ?? 0), 0), outputTokens: calls.reduce((s, x) => s + (x.outputTokens ?? 0), 0), latencyMs: Date.now() - t0, calls: calls.length };
  }
}

const jobs = models.flatMap(m => cases.flatMap(c => Array.from({ length: reps }, (_, r) => ({ m, c, r }))));
console.error(`Ejecutando ${jobs.length} llamadas (${models.length} modelos × ${cases.length} casos × ${reps} rep) con prompt ${variant}…`);
const records: RunRecord[] = []; let next = 0, done = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (next < jobs.length) { const j = jobs[next++]!; records.push(await runOne(j.m, j.c, j.r)); process.stderr.write(`\r${++done}/${jobs.length}`); }
}));
process.stderr.write('\n');

const file: RunFile = { label, createdAt: new Date().toISOString(), promptVariant: variant, models, records };
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', `${label}.json`), JSON.stringify(file, null, 1));
const report = renderReport(file, CASES, split);
const docs = path.resolve(here, '../../../docs/eval'); fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(path.join(docs, `${label}.md`), report);
console.log(report);
