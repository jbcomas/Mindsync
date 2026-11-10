// Re-puntúa una corrida guardada SIN llamar a ningún modelo (gratis). Uso: npx tsx eval/rescore.ts <label> [dev|test|all] [--summary]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.js';
import { renderReport, type RunFile } from './report.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const [label, split = 'dev'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const file = JSON.parse(fs.readFileSync(path.join(here, 'results', `${label}.json`), 'utf8')) as RunFile;
console.log(renderReport(file, CASES, split as 'dev' | 'test' | 'all', !process.argv.includes('--summary')));
