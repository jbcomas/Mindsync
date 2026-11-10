// Prueba manual SOLO con Gemini. Uso: npx tsx --env-file=../../.env scripts/smoke-gemini.mts
import { createGateway, geminiProvider, type CallRecord } from '@mindsync/llm';
import { extractChunk } from '../src/index.js';

const SAMPLE = `Ana: Tenemos que automatizar el proceso de deploy, hoy tarda dos horas y falla seguido.
Luis: Estoy de acuerdo, pero primero necesitamos presupuesto aprobado. Yo lo hablo con finanzas esta semana.
Ana: Perfecto. Además, se me ocurre que podríamos usar agentes autónomos para revisar los logs después de cada deploy.
Luis: Eso suena interesante, pero no sé si el cliente Acme lo aceptaría por temas de confidencialidad.
Ana: Entonces decidimos arrancar con el deploy automático y dejar los agentes para evaluarlos el mes que viene.`;

const model = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';
const calls: CallRecord[] = [];
const r = [{ provider: 'gemini', model }];
const gateway = createGateway({
  providers: { gemini: geminiProvider() },
  routes: { classify: r, extract: r, relate: r, ideate: r, write: r },
  embedding: { provider: 'gemini', model: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001', dimensions: 1024 },
  onCall: c => { calls.push(c); },
});

const out = await extractChunk(gateway, { text: SAMPLE, dataClass: 'personal' });
console.log(`modelo: ${model} · items: ${out.items.length} · citas descartadas: ${out.droppedQuotes}`);
for (const [i, it] of out.items.entries()) console.log(` ${i}. [${it.type}/${it.epistemic_status}] ${it.title} · ${it.speaker ?? '-'}\n      "${it.quote}"`);
for (const rel of out.relations) console.log(` rel ${rel.from} -${rel.kind}-> ${rel.to}`);

const [a, b, c] = await gateway.embed(['Automatizar el deploy con agentes', 'Automatizar el despliegue con agentes autónomos', 'Receta de milanesas con puré'], 'personal');
const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
console.log(`\nembeddings: dim=${a!.length} norma=${Math.sqrt(dot(a!, a!)).toFixed(3)} · similares=${dot(a!, b!).toFixed(3)} · distintos=${dot(a!, c!).toFixed(3)}`);
console.log('llamadas:', calls.map(c => `${c.model} ok=${c.ok} in=${c.inputTokens ?? '-'} out=${c.outputTokens ?? '-'} ${c.latencyMs}ms ${c.errorKind ?? ''}`));
