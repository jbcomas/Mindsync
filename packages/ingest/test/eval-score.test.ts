import { describe, expect, it } from 'vitest';
import { aggregate, coverage, norm, scoreCase, type Case, type Extracted, type Item } from '../eval/score.js';
import { CASES } from '../eval/cases.js';

const VALID_TYPES = ['idea', 'task', 'decision', 'person', 'project', 'concept', 'event', 'organization'];

describe('banco de casos (consistencia de las etiquetas)', () => {
  it('hay casos de desarrollo y de reserva, con ids únicos', () => {
    const ids = CASES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CASES.filter(c => c.split === 'dev').length).toBeGreaterThanOrEqual(8);
    expect(CASES.filter(c => c.split === 'test').length).toBeGreaterThanOrEqual(4);
  });

  for (const c of CASES) describe(c.id, () => {
    it('todos los anclas y trampas aparecen literalmente en el texto', () => {
      for (const a of [...c.expected.map(e => e.anchor), ...(c.forbidden ?? []).map(f => f.anchor)])
        expect(coverage(c.text, a), `ancla: «${a}»`).toBe(1);
    });
    it('tipos válidos, ids únicos y relaciones que apuntan a items existentes', () => {
      const ids = c.expected.map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of c.expected) for (const t of e.type) expect(VALID_TYPES, `${e.id}: ${t}`).toContain(t);
      for (const r of c.relations ?? []) { expect(ids).toContain(r.from); expect(ids).toContain(r.to); }
      for (const f of c.forbidden ?? []) for (const t of f.types ?? []) expect(VALID_TYPES).toContain(t);
    });
    it('las anclas alternativas aparecen en el texto y sus hablantes existen', () => {
      for (const e of c.expected) for (const a of e.alts ?? []) { expect(coverage(c.text, a.anchor), `alt: «${a.anchor}»`).toBe(1); if (a.speaker) expect(norm(c.text)).toContain(norm(a.speaker)); }
    });
    it('ORÁCULO de alternativas: citar cualquier alternativa (con su hablante) también puntúa completo', () => {
      for (const e of c.expected) for (const a of e.alts ?? []) {
        const item: Item = { type: e.type[0]!, title: e.anchor, body: (e.mustContain ?? []).map(g => g[0]).join(' '), epistemic_status: e.epistemic?.[0] ?? 'claim', speaker: a.speaker ?? e.speaker, quote: a.anchor };
        const only: Case = { ...c, expected: [e], relations: [], forbidden: [], allowed: [] };
        const sc = scoreCase(only, { items: [item], relations: [], droppedQuotes: 0 });
        expect(sc.full, `${e.id} vía «${a.anchor}»`).toBe(1);
      }
    });
    it('los hablantes esperados existen en el texto', () => {
      for (const e of c.expected) if (e.speaker) expect(norm(c.text), e.id).toContain(norm(e.speaker));
    });
    it('ORÁCULO: la extracción perfecta construida desde las etiquetas puntúa 100% y sin violaciones (las etiquetas son coherentes)', () => {
      const items: Item[] = c.expected.map(e => ({
        type: e.type[0]!, title: e.anchor, body: (e.mustContain ?? []).map(g => g[0]).join(' '),
        epistemic_status: e.epistemic?.[0] ?? 'claim', speaker: e.speaker, quote: e.anchor,
      }));
      const relations = (c.relations ?? []).map(r => ({ from: c.expected.findIndex(e => e.id === r.from), to: c.expected.findIndex(e => e.id === r.to), kind: r.kinds?.[0] ?? 'relates_to' }));
      const s = scoreCase(c, { items, relations, droppedQuotes: 0 });
      expect(s.missed, 'faltantes').toEqual([]);
      expect(s.full).toBe(c.expected.length);
      expect(s.violations).toEqual([]);
      expect(s.extras).toEqual([]);
      expect(s.relFound).toBe(s.relN);
    });
  });

  it('los casos de reserva no comparten textos con los de desarrollo', () => {
    const dev = new Set(CASES.filter(c => c.split === 'dev').map(c => c.text));
    for (const c of CASES.filter(c => c.split === 'test')) expect(dev.has(c.text)).toBe(false);
  });
});

describe('puntaje', () => {
  it('un item respaldado por una ancla ALTERNATIVA se encuentra, y se le exige el hablante de ESA frase', () => {
    const k: Case = { id: 'k', split: 'dev', kind: 'meeting', note: '', text: 'Ana: ¿podés enviar el informe? Luis: Dale, lo envío el lunes.',
      expected: [{ id: 'inf', type: ['task'], anchor: '¿podés enviar el informe?', speaker: 'Ana', alts: [{ anchor: 'Dale, lo envío el lunes', speaker: 'Luis' }] }] };
    const base: Item = { type: 'task', title: 'Enviar informe', epistemic_status: 'proposal', quote: 'Dale, lo envío el lunes' };
    expect(scoreCase(k, { items: [{ ...base, speaker: 'Luis' }], relations: [], droppedQuotes: 0 }).full).toBe(1);
    const wrong = scoreCase(k, { items: [{ ...base, speaker: 'Ana' }], relations: [], droppedQuotes: 0 });
    expect(wrong.found).toBe(1); expect(wrong.full).toBe(0); expect(wrong.wrongSpeaker[0]).toMatch(/esperado Luis/);
  });
  const c: Case = {
    id: 'x', split: 'dev', kind: 'meeting', note: '', text: 'Ana: yo mando el informe el lunes. Luis: jaja vendámosle a la NASA. Ana: reservar la sala.',
    expected: [
      { id: 'informe', type: ['task'], anchor: 'yo mando el informe el lunes', speaker: 'Ana', mustContain: [['informe'], ['lunes']] },
      { id: 'sala', type: ['task'], anchor: 'reservar la sala', speaker: 'Ana' },
    ],
    allowed: ['luis'], forbidden: [{ anchor: 'vendámosle a la NASA', why: 'broma' }],
  };
  const mk = (o: Partial<Item>): Item => ({ type: 'task', title: 't', epistemic_status: 'proposal', speaker: 'Ana', quote: '', ...o });
  const run = (items: Item[], relations: Extracted['relations'] = [], dropped = 0) => scoreCase(c, { items, relations, droppedQuotes: dropped });

  it('acierta cuando todo coincide (ignorando mayúsculas y tildes)', () => {
    const s = run([mk({ title: 'Mandar informe el lunes', body: '', quote: 'YO MANDO EL INFORME EL LUNES' }), mk({ title: 'Reservar sala', quote: 'reservar la sala' })]);
    expect(s).toMatchObject({ found: 2, typeOk: 2, speakerOk: 2, full: 2 });
  });
  it('cita parcial que cubre ≥60% del ancla cuenta como encontrada; muy parcial, no', () => {
    expect(run([mk({ title: 'informe lunes', quote: 'mando el informe el lunes' })]).found).toBe(1);
    expect(run([mk({ quote: 'el lunes' })]).found).toBe(0);
  });
  it('detecta tipo, hablante y contenido incorrectos por separado', () => {
    const s = run([mk({ type: 'idea', speaker: 'Luis', title: 'algo', quote: 'yo mando el informe el lunes' })]);
    expect(s.found).toBe(1); expect(s.typeOk).toBe(0); expect(s.speakerOk).toBe(0); expect(s.contentOk).toBe(0); expect(s.full).toBe(0);
    expect(s.wrongType[0]).toMatch(/idea/); expect(s.wrongSpeaker[0]).toMatch(/Luis/); expect(s.wrongContent[0]).toMatch(/informe/);
  });
  it('un solo item no puede satisfacer dos esperados', () => {
    const s = run([mk({ title: 'informe lunes', quote: 'yo mando el informe el lunes. Ana: reservar la sala' })]);
    expect(s.found).toBe(1); expect(s.missed).toHaveLength(1);
  });
  it('items sin pareja son "extras", salvo los permitidos', () => {
    const s = run([mk({ title: 'Luis hizo un chiste', quote: 'jaja' }), mk({ title: 'cosa inventada', quote: 'nada que ver' })]);
    expect(s.extras).toHaveLength(1); expect(s.extras[0]).toMatch(/inventada/);
  });
  it('una trampa extraída es una violación', () => {
    const s = run([mk({ title: 'Vender a la NASA', quote: 'jaja vendámosle a la NASA' })]);
    expect(s.violations).toHaveLength(1);
  });
  it('maxItems y forbiddenText', () => {
    const e: Case = { ...c, expected: [], maxItems: 0, forbidden: [], forbiddenText: [/secreto/i] };
    expect(scoreCase(e, { items: [], relations: [], droppedQuotes: 0 }).violations).toEqual([]);
    expect(scoreCase(e, { items: [mk({ title: 'algo', quote: 'x' })], relations: [], droppedQuotes: 0 }).violations).toHaveLength(1);
    expect(scoreCase({ ...e, maxItems: undefined }, { items: [mk({ title: 'el secreto', quote: 'x' })], relations: [], droppedQuotes: 0 }).violations).toHaveLength(1);
  });
  it('relaciones: se cuentan solo si conectan los items correctos (en cualquier sentido) con un tipo permitido', () => {
    const k: Case = { ...c, relations: [{ from: 'informe', to: 'sala', kinds: ['depends_on'] }] };
    const items = [mk({ quote: 'yo mando el informe el lunes', title: 'informe lunes' }), mk({ quote: 'reservar la sala', title: 'sala' })];
    const sc = (rel: Extracted['relations']) => scoreCase(k, { items, relations: rel, droppedQuotes: 0 }).relFound;
    expect(sc([{ from: 1, to: 0, kind: 'depends_on' }])).toBe(1);
    expect(sc([{ from: 0, to: 1, kind: 'supports' }])).toBe(0);
    expect(sc([])).toBe(0);
  });
  it('aggregate: razones seguras ante cero y tasa de citas descartadas', () => {
    const a = aggregate([run([], [], 0)]);
    expect(a.recall).toBe(0); expect(a.noiseRate).toBe(1); expect(a.typeAcc).toBe(1);
    const b = aggregate([run([mk({ quote: 'reservar la sala' })], [], 1)]);
    expect(b.droppedQuoteRate).toBeCloseTo(0.5);
  });
});
