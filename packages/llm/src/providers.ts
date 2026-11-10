import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema.js';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { LlmProvider, Message } from './types.js';

/**
 * Anthropic. Salida estructurada vía `output_config.format` (json_schema).
 * Los modelos actuales (p. ej. claude-sonnet-5-5, claude-opus-5-5) rechazan `tool_choice` forzado con 400,
 * así que NO se usa tool-use para obtener JSON. La API no admite cotas (maxItems, minLength...): el transformador del SDK
 * las mueve a la descripción y el gateway las revalida con Zod después.
 */
export function anthropicProvider(apiKey = process.env.ANTHROPIC_API_KEY): LlmProvider {
  const client = new Anthropic({ apiKey });
  return {
    name: 'anthropic',
    async complete({ model, system, messages, maxTokens, jsonSchema }) {
      const res = await client.messages.create({
        model, max_tokens: maxTokens, system,
        messages: messages as Anthropic.MessageParam[],
        ...(jsonSchema && { output_config: { format: { type: 'json_schema' as const, schema: transformJSONSchema(jsonSchema.schema) as Record<string, unknown> } } }),
      });
      if (res.stop_reason === 'refusal') throw new Error('refusal');
      const text = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
      return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    },
  };
}

/**
 * Cualquier API compatible con OpenAI: OpenAI, Ollama (http://localhost:11434/v1), vLLM, LM Studio...
 * Un solo adaptador cubre los modelos locales.
 */
export function openAiCompatibleProvider(opts: { name?: string; apiKey?: string; baseURL?: string } = {}): LlmProvider {
  const client = new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY ?? 'not-needed', baseURL: opts.baseURL });
  return {
    name: opts.name ?? 'openai',
    async complete({ model, system, messages, maxTokens, jsonSchema }) {
      const res = await client.chat.completions.create({
        model, max_completion_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages.map((m: Message) => ({ role: m.role, content: m.content }))],
        ...(jsonSchema && { response_format: { type: 'json_schema' as const, json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: false } } }),
      });
      const text = res.choices[0]?.message?.content ?? '';
      return { text, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
    },
    async embed({ model, inputs, dimensions }) {
      const res = await client.embeddings.create({ model, input: inputs, dimensions });
      return res.data.map(d => d.embedding);
    },
  };
}

export const TRANSCRIBE_PROMPT = `Transcribí este audio literalmente, en su idioma original. Si hablan varias personas, empezá cada turno en una línea nueva con "Hablante 1:", "Hablante 2:", etc. (la misma persona siempre con el mismo número). No resumas, no traduzcas, no agregues comentarios ni explicaciones. Si algo no se entiende, escribí [inaudible]. Si no hay voz, devolvé exactamente [sin voz].`;

/** Subconjunto del cliente de @google/genai que usamos; permite inyectar un doble en los tests. */
export interface GeminiClientLike {
  models: {
    generateContent(p: {
      model: string;
      contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[];
      config?: Record<string, unknown>;
    }): Promise<{
      text?: string;
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    }>;
    embedContent(p: { model: string; contents: string[]; config?: Record<string, unknown> }): Promise<{ embeddings?: { values?: number[] }[] }>;
  };
  /** Files API: para audios grandes (el inline tiene un tope de ~20 MB por pedido). */
  files?: {
    upload(p: { file: Blob; config?: { mimeType?: string } }): Promise<{ name?: string; uri?: string; mimeType?: string; state?: string }>;
    get(p: { name: string }): Promise<{ name?: string; uri?: string; mimeType?: string; state?: string }>;
    delete(p: { name: string }): Promise<unknown>;
  };
}

/** Por encima de esto el audio se sube con la Files API en vez de ir en base64 dentro del pedido. */
export const INLINE_AUDIO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Google Gemini (SDK oficial @google/genai). Salida estructurada con `responseJsonSchema`. Embeddings con `outputDimensionality`: para dimensiones menores a la nativa los vectores
 * no vienen normalizados, así que se normalizan acá (la búsqueda por coseno lo asume).
 */
export function geminiProvider(opts: { apiKey?: string; client?: GeminiClientLike } = {}): LlmProvider {
  const client: GeminiClientLike = opts.client
    ?? (new GoogleGenAI({ apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY }) as unknown as GeminiClientLike);
  return {
    name: 'gemini',
    async complete({ model, system, messages, maxTokens, jsonSchema }) {
      const res = await client.models.generateContent({
        model,
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' as const : 'user' as const, parts: [{ text: m.content }] })),
        config: {
          systemInstruction: system,
          maxOutputTokens: maxTokens,
          ...(jsonSchema && { responseMimeType: 'application/json', responseJsonSchema: portableSchema(jsonSchema.schema) }),
        },
      });
      if (res.promptFeedback?.blockReason) throw new Error('blocked');
      const text = res.text ?? '';
      if (!text) throw new Error(`empty:${res.candidates?.[0]?.finishReason ?? 'unknown'}`);
      const u = res.usageMetadata ?? {};
      return { text, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
    },
    async transcribe({ model, audio, mime }) {
      let uploaded: string | undefined;
      try {
        let audioPart: Record<string, unknown>;
        if (audio.length <= INLINE_AUDIO_MAX_BYTES) {
          audioPart = { inlineData: { mimeType: mime, data: audio.toString('base64') } };
        } else {
          if (!client.files) throw new Error('files_api_unavailable');
          let f = await client.files.upload({ file: new Blob([new Uint8Array(audio)], { type: mime }), config: { mimeType: mime } });
          uploaded = f.name;
          // El archivo se procesa de forma asíncrona: esperar a ACTIVE (máx. ~5 min).
          for (let i = 0; i < 150 && f.state !== 'ACTIVE'; i++) {
            if (f.state === 'FAILED') throw new Error('file_processing_failed');
            await new Promise(r => setTimeout(r, 2000));
            f = await client.files.get({ name: f.name! });
          }
          if (f.state !== 'ACTIVE') throw new Error('file_processing_timeout');
          audioPart = { fileData: { fileUri: f.uri, mimeType: f.mimeType ?? mime } };
        }
        const res = await client.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [audioPart, { text: TRANSCRIBE_PROMPT }] }],
          config: { maxOutputTokens: 32768 },
        });
        if (res.promptFeedback?.blockReason) throw new Error('blocked');
        const text = (res.text ?? '').trim();
        if (!text) throw new Error(`empty:${res.candidates?.[0]?.finishReason ?? 'unknown'}`);
        const u = res.usageMetadata ?? {};
        return { text, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
      } finally {
        // Privacidad: no dejar el audio en el proveedor (si no, se conserva hasta 48 h).
        if (uploaded) await client.files!.delete({ name: uploaded }).catch(() => {});
      }
    },
    async embed({ model, inputs, dimensions }) {
      const res = await client.models.embedContent({ model, contents: inputs, config: { outputDimensionality: dimensions } });
      const vecs = (res.embeddings ?? []).map(e => e.values ?? []);
      if (vecs.length !== inputs.length || vecs.some(v => v.length !== dimensions)) throw new Error('embedding_shape');
      return vecs.map(normalize);
    },
  };
}

/**
 * Esquema "portable": sin cotas (maxItems, minLength, minimum...) ni $schema. Gemini devuelve 400 genérico con el
 * esquema completo de Zod; las cotas igual se revalidan en el gateway.
 */
function portableSchema(schema: Record<string, unknown>) {
  const out = transformJSONSchema(schema) as Record<string, unknown>;
  delete out.description;
  return out;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / n);
}
