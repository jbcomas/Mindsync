import { describe, expect, it } from 'vitest';
import { geminiProvider, INLINE_AUDIO_MAX_BYTES, type GeminiClientLike } from '../src/index.js';

function fakeClient(over: Partial<ReturnType<GeminiClientLike['models']['generateContent']> extends Promise<infer R> ? R : never> = {}) {
  const seen: any = {};
  const client: GeminiClientLike = {
    models: {
      async generateContent(p) { seen.gen = p; return { text: '{"ok":true}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6 }, ...over }; },
      async embedContent(p) { seen.emb = p; return { embeddings: p.contents.map(() => ({ values: [3, 4, 0, 0] })) }; },
    },
  };
  return { client, seen };
}
const args = { model: 'm', system: 'sys', maxTokens: 100, messages: [{ role: 'user' as const, content: 'hola' }, { role: 'assistant' as const, content: 'que tal' }, { role: 'user' as const, content: 'ok' }] };

describe('geminiProvider', () => {
  it('mapea roles (assistant -> model), system a systemInstruction y suma tokens de razonamiento', async () => {
    const { client, seen } = fakeClient();
    const r = await geminiProvider({ client }).complete(args);
    expect(seen.gen.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(seen.gen.config).toMatchObject({ systemInstruction: 'sys', maxOutputTokens: 100 });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 10 });
  });

  it('con esquema pide JSON y no envía la clave $schema', async () => {
    const { client, seen } = fakeClient();
    await geminiProvider({ client }).complete({ ...args, jsonSchema: { name: 'x', schema: { $schema: 'http://json-schema.org/draft/2020-12/schema', type: 'object', properties: { a: { type: 'array', items: { type: 'string' }, maxItems: 3 } } } } });
    expect(seen.gen.config.responseMimeType).toBe('application/json');
    const sent = seen.gen.config.responseJsonSchema;
    expect(sent.$schema).toBeUndefined();
    expect(sent.properties.a.maxItems).toBeUndefined(); // la cota ya no es un keyword del esquema (Gemini devuelve 400 con ellos)
    expect(seen.gen.config.responseJsonSchema.properties.a.type).toBe('array');
  });

  it('sin esquema no fuerza JSON', async () => {
    const { client, seen } = fakeClient();
    await geminiProvider({ client }).complete(args);
    expect(seen.gen.config.responseMimeType).toBeUndefined();
  });

  it('falla (sin incluir contenido) si el prompt fue bloqueado o la respuesta viene vacía', async () => {
    await expect(geminiProvider({ client: fakeClient({ promptFeedback: { blockReason: 'SAFETY' } }).client }).complete(args)).rejects.toThrow('blocked');
    await expect(geminiProvider({ client: fakeClient({ text: '', candidates: [{ finishReason: 'MAX_TOKENS' }] }).client }).complete(args)).rejects.toThrow('empty:MAX_TOKENS');
  });

  it('embed pide la dimensión configurada y normaliza los vectores', async () => {
    const { client, seen } = fakeClient();
    const v = await geminiProvider({ client }).embed!({ model: 'e', inputs: ['a', 'b'], dimensions: 4 });
    expect(seen.emb.config).toEqual({ outputDimensionality: 4 });
    expect(v[0]).toEqual([0.6, 0.8, 0, 0]);
  });

  it('embed rechaza vectores de dimensión incorrecta', async () => {
    const { client } = fakeClient();
    await expect(geminiProvider({ client }).embed!({ model: 'e', inputs: ['a'], dimensions: 8 })).rejects.toThrow('embedding_shape');
  });

  it('transcribe envía el audio en base64 con su mime y el prompt de transcripción', async () => {
    const { client, seen } = fakeClient({ text: ' Hablante 1: hola ' });
    const r = await geminiProvider({ client }).transcribe!({ model: 't', audio: Buffer.from('abc'), mime: 'audio/webm' });
    const parts = seen.gen.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'audio/webm', data: Buffer.from('abc').toString('base64') } });
    expect(parts[1].text).toMatch(/Hablante 1/);
    expect(r.text).toBe('Hablante 1: hola');
  });

  it('audio grande: lo sube por Files API, espera a ACTIVE, lo usa por URI y lo borra siempre', async () => {
    const seen: any = { deleted: [], gets: 0 };
    const client: GeminiClientLike = {
      models: {
        async generateContent(p) { seen.gen = p; return { text: 'Hablante 1: reunión larga', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }; },
        async embedContent() { return { embeddings: [] }; },
      },
      files: {
        async upload() { return { name: 'files/abc', state: 'PROCESSING' }; },
        async get() { seen.gets++; return { name: 'files/abc', uri: 'https://x/files/abc', mimeType: 'audio/wav', state: 'ACTIVE' }; },
        async delete(p) { seen.deleted.push(p.name); return {}; },
      },
    };
    const big = Buffer.alloc(INLINE_AUDIO_MAX_BYTES + 1);
    const r = await geminiProvider({ client }).transcribe!({ model: 't', audio: big, mime: 'audio/wav' });
    expect(r.text).toContain('reunión larga');
    expect(seen.gen.contents[0].parts[0]).toEqual({ fileData: { fileUri: 'https://x/files/abc', mimeType: 'audio/wav' } });
    expect(JSON.stringify(seen.gen)).not.toContain('inlineData');
    expect(seen.deleted).toEqual(['files/abc']);
  });

  it('audio grande: aunque falle la transcripción, el archivo subido se borra', async () => {
    const deleted: string[] = [];
    const client: GeminiClientLike = {
      models: { async generateContent() { throw new Error('boom'); }, async embedContent() { return { embeddings: [] }; } },
      files: { async upload() { return { name: 'files/zzz', state: 'ACTIVE', uri: 'u', mimeType: 'audio/wav' }; }, async get() { return {}; }, async delete(p) { deleted.push(p.name); return {}; } },
    };
    await expect(geminiProvider({ client }).transcribe!({ model: 't', audio: Buffer.alloc(INLINE_AUDIO_MAX_BYTES + 1), mime: 'audio/wav' })).rejects.toThrow('boom');
    expect(deleted).toEqual(['files/zzz']);
  });

  it('audio chico va inline y no toca la Files API', async () => {
    const { client, seen } = fakeClient();
    await geminiProvider({ client }).transcribe!({ model: 't', audio: Buffer.alloc(1000), mime: 'audio/wav' });
    expect(seen.gen.contents[0].parts[0].inlineData).toBeDefined();
  });
});
