import { createHash } from 'node:crypto';
import type { LlmProvider, Message, ProviderResult } from './types.js';

type Handler = (a: { system: string; messages: Message[]; model: string }) => unknown | Promise<unknown>;

/**
 * Proveedor determinista para tests y desarrollo sin claves.
 * `handler` devuelve el objeto JSON (o string) que "respondería" el modelo.
 */
export function fakeProvider(handler: Handler, name = 'fake'): LlmProvider & { calls: number } {
  const p = {
    name, calls: 0,
    async complete({ model, system, messages, jsonSchema }: Parameters<LlmProvider['complete']>[0]): Promise<ProviderResult> {
      p.calls++;
      const out = await handler({ system, messages, model });
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      const inputTokens = Math.ceil((system.length + messages.map(m => m.content).join('').length) / 4);
      return { text, json: jsonSchema && typeof out !== 'string' ? out : undefined, usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) } };
    },
    async embed({ inputs, dimensions }: { model: string; inputs: string[]; dimensions: number }) {
      return inputs.map(s => pseudoEmbedding(s, dimensions));
    },
  };
  return p;
}

/** Vector determinista por palabras (bolsa de palabras hasheada, normalizado): textos parecidos => vectores cercanos. */
export function pseudoEmbedding(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const w of text.toLowerCase().match(/\p{L}{3,}/gu) ?? []) {
    const h = createHash('sha256').update(w).digest();
    v[h.readUInt16BE(0) % dim]! += 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / n);
}
