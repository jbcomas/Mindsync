import { z } from 'zod';
import { LlmError, type CallRecord, type CompleteRequest, type CompleteResult, type DataClass, type LlmProvider, type Task } from './types.js';

export interface Route { provider: string; model: string }

export interface GatewayConfig {
  providers: Record<string, LlmProvider>;
  /** Por tarea: lista ordenada (primero el preferido; los siguientes son fallback). */
  routes: Record<Task, Route[]>;
  /** Qué proveedores pueden recibir cada clase de dato. Ausente => todos. */
  allowedProviders?: Partial<Record<DataClass, string[]>>;
  embedding: { provider: string; model: string; dimensions: number };
  /** Transcripción de audio (opcional). */
  transcription?: Route;
  /** Se invoca por cada intento. Nunca recibe contenido (docs/08 A-7). */
  onCall?: (rec: CallRecord) => void | Promise<void>;
  maxAttempts?: number;
  /** Tiempo máximo por llamada a un proveedor. Si vence, se cuenta como error del proveedor y se pasa al siguiente de la ruta. */
  timeoutMs?: number;
}

export interface CallOptions { onCall?: (rec: CallRecord) => void | Promise<void> }

export function createGateway(cfg: GatewayConfig) {
  const maxAttempts = cfg.maxAttempts ?? 3;
  const timeoutMs = cfg.timeoutMs ?? 90_000;
  const withTimeout = <T,>(p: Promise<T>, ms = timeoutMs): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
  };

  function routesFor(task: Task, dataClass: DataClass): Route[] {
    const allowed = cfg.allowedProviders?.[dataClass];
    const rs = cfg.routes[task].filter(r => cfg.providers[r.provider] && (!allowed || allowed.includes(r.provider)));
    if (!rs.length) throw new LlmError('no_provider_allowed', `Sin proveedor permitido para task=${task} dataClass=${dataClass}`);
    return rs;
  }

  async function complete<T>(req: CompleteRequest<T>, opts: CallOptions = {}): Promise<CompleteResult<T>> {
    const emit = async (r: CallRecord) => { await cfg.onCall?.(r); await opts.onCall?.(r); };
    const routes = routesFor(req.task, req.dataClass);
    const jsonSchema = req.schema
      ? { name: req.schemaName ?? 'result', schema: z.toJSONSchema(req.schema as z.ZodType) as Record<string, unknown> }
      : undefined;
    let lastKind = 'unknown';

    for (const route of routes) {
      const provider = cfg.providers[route.provider]!;
      const messages = [...req.messages];
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const t0 = Date.now();
        const rec: CallRecord = { task: req.task, provider: route.provider, model: route.model, dataClass: req.dataClass, latencyMs: 0, ok: false };
        try {
          const res = await withTimeout(provider.complete({ model: route.model, system: req.system, messages, maxTokens: req.maxTokens ?? 4096, jsonSchema }));
          rec.inputTokens = res.usage.inputTokens; rec.outputTokens = res.usage.outputTokens;
          if (!req.schema) {
            rec.ok = true; rec.latencyMs = Date.now() - t0; await emit(rec);
            return { text: res.text, usage: res.usage, provider: route.provider, model: route.model, attempts: attempt };
          }
          let candidate: unknown = res.json;
          if (candidate === undefined) {
            try { candidate = JSON.parse(stripFences(res.text)); } catch { candidate = undefined; }
          }
          const parsed = req.schema.safeParse(candidate);
          if (parsed.success) {
            rec.ok = true; rec.latencyMs = Date.now() - t0; await emit(rec);
            return { text: res.text, data: parsed.data, usage: res.usage, provider: route.provider, model: route.model, attempts: attempt };
          }
          // Reintento con realimentación del error de validación (sin devolver contenido al log).
          rec.errorKind = 'invalid_output'; lastKind = 'invalid_output';
          rec.latencyMs = Date.now() - t0; await emit(rec);
          messages.push({ role: 'assistant', content: res.text });
          messages.push({ role: 'user', content: `La salida no cumple el schema: ${parsed.error.message}. Devolvé solo JSON válido.` });
        } catch (e) {
          rec.errorKind = 'provider_error'; lastKind = 'provider_error';
          rec.latencyMs = Date.now() - t0; await emit(rec);
          break; // error de proveedor: pasar al fallback, no reintentar el mismo
        }
      }
    }
    throw new LlmError(lastKind === 'invalid_output' ? 'invalid_output' : 'all_failed', `Falló task=${req.task} (${lastKind})`);
  }

  async function embed(inputs: string[], dataClass: DataClass, opts: CallOptions = {}): Promise<number[][]> {
    const emit = async (r: CallRecord) => { await cfg.onCall?.(r); await opts.onCall?.(r); };
    const allowed = cfg.allowedProviders?.[dataClass];
    const e = cfg.embedding;
    if (allowed && !allowed.includes(e.provider)) throw new LlmError('no_provider_allowed', `Embeddings no permitidos para ${dataClass}`);
    const provider = cfg.providers[e.provider];
    if (!provider?.embed) throw new LlmError('unsupported', `El proveedor ${e.provider} no soporta embeddings`);
    const t0 = Date.now();
    try {
      const out: number[][] = [];
      for (let i = 0; i < inputs.length; i += 64) out.push(...await withTimeout(provider.embed({ model: e.model, inputs: inputs.slice(i, i + 64), dimensions: e.dimensions })));
      await emit({ task: 'classify', provider: e.provider, model: e.model, dataClass, latencyMs: Date.now() - t0, ok: true });
      return out;
    } catch (err) {
      await emit({ task: 'classify', provider: e.provider, model: e.model, dataClass, latencyMs: Date.now() - t0, ok: false, errorKind: 'provider_error' });
      throw err;
    }
  }

  async function transcribe(audio: Buffer, mime: string, dataClass: DataClass, opts: CallOptions = {}): Promise<string> {
    const emit = async (r: CallRecord) => { await cfg.onCall?.(r); await opts.onCall?.(r); };
    const t = cfg.transcription;
    const allowed = cfg.allowedProviders?.[dataClass];
    if (!t || !cfg.providers[t.provider]?.transcribe) throw new LlmError('unsupported', 'No hay proveedor de transcripción configurado');
    if (allowed && !allowed.includes(t.provider)) throw new LlmError('no_provider_allowed', `Transcripción no permitida para ${dataClass}`);
    const t0 = Date.now();
    const rec: CallRecord = { task: 'extract', provider: t.provider, model: t.model, dataClass, latencyMs: 0, ok: false };
    try {
      const res = await withTimeout(cfg.providers[t.provider]!.transcribe!({ model: t.model, audio, mime }), 5 * 60_000);
      rec.ok = true; rec.inputTokens = res.usage.inputTokens; rec.outputTokens = res.usage.outputTokens; rec.latencyMs = Date.now() - t0; await emit(rec);
      return res.text;
    } catch (err) {
      rec.errorKind = 'provider_error'; rec.latencyMs = Date.now() - t0; await emit(rec);
      throw new LlmError('all_failed', 'Falló la transcripción');
    }
  }

  return { complete, embed, transcribe, embeddingModel: cfg.embedding.model };
}

export type Gateway = ReturnType<typeof createGateway>;

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}
