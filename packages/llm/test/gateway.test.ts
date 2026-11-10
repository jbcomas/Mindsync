import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGateway, fakeProvider, LlmError, type CallRecord, type LlmProvider } from '../src/index.js';

const schema = z.object({ items: z.array(z.string()) });
const routes = (r: { provider: string; model: string }[]) => ({ classify: r, extract: r, relate: r, ideate: r, write: r });
const base = { embedding: { provider: 'a', model: 'e', dimensions: 8 } };
const req = { task: 'extract' as const, system: 's', messages: [{ role: 'user' as const, content: 'SECRETO-DEL-CLIENTE' }], dataClass: 'personal' as const };

describe('gateway', () => {
  it('devuelve datos validados contra el schema', async () => {
    const a = fakeProvider(() => ({ items: ['x'] }), 'a');
    const g = createGateway({ ...base, providers: { a }, routes: routes([{ provider: 'a', model: 'm' }]) });
    const r = await g.complete({ ...req, schema });
    expect(r.data).toEqual({ items: ['x'] });
    expect(r.attempts).toBe(1);
  });

  it('reintenta con el error de validación y se recupera', async () => {
    let n = 0;
    const a = fakeProvider(({ messages }) => (n++ === 0 ? { wrong: 1 } : (expect(messages.at(-1)!.content).toMatch(/no cumple el schema/), { items: ['ok'] })), 'a');
    const g = createGateway({ ...base, providers: { a }, routes: routes([{ provider: 'a', model: 'm' }]) });
    const r = await g.complete({ ...req, schema });
    expect(r.data).toEqual({ items: ['ok'] });
    expect(r.attempts).toBe(2);
  });

  it('acepta JSON dentro de bloques ```json', async () => {
    const a = fakeProvider(() => '```json\n{"items":["y"]}\n```', 'a');
    const g = createGateway({ ...base, providers: { a }, routes: routes([{ provider: 'a', model: 'm' }]) });
    expect((await g.complete({ ...req, schema })).data).toEqual({ items: ['y'] });
  });

  it('si el proveedor falla, usa el siguiente de la ruta', async () => {
    const bad: LlmProvider = { name: 'bad', complete: async () => { throw new Error('boom SECRETO-DEL-CLIENTE'); } };
    const b = fakeProvider(() => ({ items: ['b'] }), 'b');
    const g = createGateway({ ...base, providers: { bad, b }, routes: routes([{ provider: 'bad', model: 'm' }, { provider: 'b', model: 'm' }]) });
    const r = await g.complete({ ...req, schema });
    expect(r.provider).toBe('b');
  });

  it('falla con LlmError si la salida nunca es válida', async () => {
    const a = fakeProvider(() => ({ nope: true }), 'a');
    const g = createGateway({ ...base, providers: { a }, routes: routes([{ provider: 'a', model: 'm' }]), maxAttempts: 2 });
    await expect(g.complete({ ...req, schema })).rejects.toMatchObject({ kind: 'invalid_output' });
    expect(a.calls).toBe(2);
  });

  it('respeta data_class: restricted nunca llega a un proveedor no permitido', async () => {
    const cloud = fakeProvider(() => ({ items: [] }), 'cloud');
    const g = createGateway({ ...base, providers: { cloud }, routes: routes([{ provider: 'cloud', model: 'm' }]), allowedProviders: { restricted: ['local'] } });
    await expect(g.complete({ ...req, dataClass: 'restricted', schema })).rejects.toBeInstanceOf(LlmError);
    expect(cloud.calls).toBe(0);
    await expect(g.embed(['x'], 'restricted')).rejects.toMatchObject({ kind: 'no_provider_allowed' });
  });

  it('los registros de llamada nunca contienen contenido (docs/08 A-7)', async () => {
    const recs: CallRecord[] = [];
    const bad: LlmProvider = { name: 'bad', complete: async () => { throw new Error('SECRETO-DEL-CLIENTE'); } };
    const a = fakeProvider(() => ({ items: ['SECRETO-DEL-CLIENTE'] }), 'a');
    const g = createGateway({ ...base, providers: { bad, a }, routes: routes([{ provider: 'bad', model: 'm' }, { provider: 'a', model: 'm' }]), onCall: r => { recs.push(r); } });
    await g.complete({ ...req, schema });
    expect(recs.length).toBe(2);
    expect(JSON.stringify(recs)).not.toContain('SECRETO');
  });

  it('embed devuelve vectores de la dimensión configurada', async () => {
    const a = fakeProvider(() => ({}), 'a');
    const g = createGateway({ ...base, providers: { a }, routes: routes([{ provider: 'a', model: 'm' }]) });
    const v = await g.embed(['hola mundo', 'otra cosa'], 'personal');
    expect(v.length).toBe(2);
    expect(v[0]!.length).toBe(8);
  });

  it('un proveedor colgado vence por timeout y se usa el siguiente de la ruta', async () => {
    const hung: LlmProvider = { name: 'hung', complete: () => new Promise(() => {}) };
    const b = fakeProvider(() => ({ items: ['b'] }), 'b');
    const g = createGateway({ ...base, providers: { hung, b }, routes: routes([{ provider: 'hung', model: 'm' }, { provider: 'b', model: 'm' }]), timeoutMs: 50 });
    const r = await g.complete({ ...req, schema });
    expect(r.provider).toBe('b');
  });
});

describe('gateway.transcribe', () => {
  const mk = (extra: object = {}) => {
    const a = { name: 'a', complete: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 } }), transcribe: async () => ({ text: 'Hablante 1: hola', usage: { inputTokens: 5, outputTokens: 3 } }) } as LlmProvider;
    return createGateway({ ...base, providers: { a }, routes: routes([{ provider: 'a', model: 'm' }]), transcription: { provider: 'a', model: 't' }, ...extra });
  };
  it('devuelve el texto y registra la llamada sin contenido', async () => {
    const recs: CallRecord[] = [];
    const g = mk({ onCall: (r: CallRecord) => { recs.push(r); } });
    expect(await g.transcribe(Buffer.from('x'), 'audio/webm', 'personal')).toBe('Hablante 1: hola');
    expect(JSON.stringify(recs)).not.toContain('hola');
    expect(recs[0]).toMatchObject({ ok: true, inputTokens: 5 });
  });
  it('respeta data_class y falla con claridad si no hay proveedor', async () => {
    await expect(mk({ allowedProviders: { restricted: ['local'] } }).transcribe(Buffer.from('x'), 'audio/webm', 'restricted')).rejects.toMatchObject({ kind: 'no_provider_allowed' });
    const g = createGateway({ ...base, providers: {}, routes: routes([]) });
    await expect(g.transcribe(Buffer.from('x'), 'audio/webm', 'personal')).rejects.toMatchObject({ kind: 'unsupported' });
  });
});
