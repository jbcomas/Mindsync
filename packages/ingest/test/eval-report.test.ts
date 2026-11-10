import { describe, expect, it } from 'vitest';
import { CASES } from '../eval/cases.js';
import { renderReport, scoreRun, type RunFile, type RunRecord } from '../eval/report.js';
import type { Item } from '../eval/score.js';

const oracle = (model: string): RunRecord[] => CASES.map(c => ({
  model, prompt: 'v1', caseId: c.id, rep: 0, inputTokens: 1000, outputTokens: 500, latencyMs: 100, calls: 1,
  extracted: {
    items: c.expected.map(e => ({ type: e.type[0]!, title: e.anchor, body: (e.mustContain ?? []).map(g => g[0]).join(' '), epistemic_status: e.epistemic?.[0] ?? 'claim', speaker: e.speaker, quote: e.anchor }) as Item),
    relations: (c.relations ?? []).map(r => ({ from: c.expected.findIndex(e => e.id === r.from), to: c.expected.findIndex(e => e.id === r.to), kind: r.kinds?.[0] ?? 'relates_to' })), droppedQuotes: 0,
  },
}));

describe('informe de la evaluación', () => {
  const file: RunFile = { label: 't', createdAt: 'hoy', promptVariant: 'v1', models: ['anthropic:claude-sonnet-5-5', 'gemini:x'], records: [...oracle('anthropic:claude-sonnet-5-5'), ...oracle('gemini:x')] };

  it('el oráculo obtiene 100% y 0 violaciones en dev y en test', () => {
    for (const split of ['dev', 'test'] as const) for (const m of file.models) {
      const a = scoreRun(file, CASES, split)[m]!.agg;
      expect([a.recall, a.fullRate, a.typeAcc, a.speakerAcc, a.contentAcc, a.relRecall]).toEqual([1, 1, 1, 1, 1, 1]);
      expect(a.violations).toBe(0); expect(a.noiseRate).toBe(0);
    }
  });
  it('filtra por división: dev y test no se mezclan', () => {
    const dev = scoreRun(file, CASES, 'dev')[file.models[0]!]!, test = scoreRun(file, CASES, 'test')[file.models[0]!]!, all = scoreRun(file, CASES, 'all')[file.models[0]!]!;
    expect(dev.n + test.n).toBe(all.n);
    expect(dev.n).toBe(CASES.filter(c => c.split === 'dev').length);
  });
  it('calcula el costo solo para modelos con precio verificado ("n/d" para los demás)', () => {
    const r = scoreRun(file, CASES, 'dev');
    expect(r['anthropic:claude-sonnet-5-5']!.cost).toBeCloseTo((9 * 1000 * 2 + 9 * 500 * 10) / 1e6, 6);
    expect(r['gemini:x']!.cost).toBeNull();
    expect(renderReport(file, CASES, 'dev', false)).toContain('n/d');
  });
  it('un fallo de llamada cuenta como cero items (no se oculta)', () => {
    const bad: RunFile = { ...file, models: ['m'], records: [{ model: 'm', prompt: 'v1', caseId: 'ventas-cliente', rep: 0, extracted: null, error: 'all_failed', inputTokens: 0, outputTokens: 0, latencyMs: 1, calls: 1 }] };
    const r = scoreRun(bad, CASES, 'dev').m!;
    expect(r.failures).toBe(1); expect(r.agg.recall).toBe(0);
    expect(renderReport(bad, CASES, 'dev')).toContain('all_failed');
  });
});
