// Prueba manual contra el proveedor REAL. Uso: npx tsx --env-file=../../.env scripts/smoke-extract.ts [archivo.txt]
import fs from 'node:fs';
import { defaultGateway, type CallRecord } from '@mindsync/llm';
import { chunkText, extractChunk } from '../src/index.js';

const SAMPLE = `Ana: Tenemos que automatizar el proceso de deploy, hoy tarda dos horas y falla seguido.
Luis: Estoy de acuerdo, pero primero necesitamos presupuesto aprobado. Yo lo hablo con finanzas esta semana.
Ana: Perfecto. Además, se me ocurre que podríamos usar agentes autónomos para revisar los logs después de cada deploy.
Luis: Eso suena interesante, pero no sé si el cliente Acme lo aceptaría por temas de confidencialidad.
Ana: Entonces decidimos arrancar con el deploy automático y dejar los agentes para evaluarlos el mes que viene.`;

const text = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : SAMPLE;
const calls: CallRecord[] = [];
const gateway = defaultGateway(r => { calls.push(r); });

for (const c of chunkText(text)) {
  const r = await extractChunk(gateway, { text: c.text, dataClass: 'personal' });
  console.log(`\n== chunk [${c.locator.start}-${c.locator.end}] speakers=${c.locator.speakers?.join(',') ?? '-'}  (citas descartadas: ${r.droppedQuotes})`);
  for (const [i, it] of r.items.entries()) console.log(` ${i}. [${it.type}/${it.epistemic_status}] ${it.title}  ·  ${it.speaker ?? '-'}  ·  conf ${it.confidence}\n      "${it.quote}"`);
  for (const rel of r.relations) console.log(` rel ${rel.from} -${rel.kind}-> ${rel.to}`);
}
console.log('\nllamadas:', calls.map(c => `${c.model} ok=${c.ok} in=${c.inputTokens} out=${c.outputTokens} ${c.latencyMs}ms${c.errorKind ? ' ' + c.errorKind : ''}`));
