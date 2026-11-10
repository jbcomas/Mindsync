import type { ZodType } from 'zod';

/** Tareas con perfil de modelo distinto (docs/02 §6). El dominio habla en tareas, no en modelos. */
export type Task = 'classify' | 'extract' | 'relate' | 'ideate' | 'write';

/** Clase de dato: restringe qué proveedores pueden recibirlo (ADR-0007). */
export type DataClass = 'personal' | 'client_confidential' | 'restricted';

export interface Message { role: 'user' | 'assistant'; content: string }

export interface CompleteRequest<T = unknown> {
  task: Task;
  system: string;
  messages: Message[];
  maxTokens?: number;
  dataClass: DataClass;
  /** Si se pasa, la salida es JSON validado contra el schema (con reintentos). */
  schema?: ZodType<T>;
  schemaName?: string;
}

export interface Usage { inputTokens: number; outputTokens: number }

export interface ProviderResult { text: string; json?: unknown; usage: Usage }

/** Contrato que implementa cada adaptador. Ningún SDK de proveedor sale de /providers (ADR-0007). */
export interface LlmProvider {
  readonly name: string;
  complete(args: {
    model: string; system: string; messages: Message[]; maxTokens: number;
    jsonSchema?: { name: string; schema: Record<string, unknown> };
  }): Promise<ProviderResult>;
  embed?(args: { model: string; inputs: string[]; dimensions: number }): Promise<number[][]>;
  transcribe?(args: { model: string; audio: Buffer; mime: string }): Promise<ProviderResult>;
}

export interface CompleteResult<T = unknown> {
  text: string;
  data?: T;
  usage: Usage;
  provider: string;
  model: string;
  attempts: number;
}

export interface CallRecord {
  task: Task; provider: string; model: string; dataClass: DataClass;
  inputTokens?: number; outputTokens?: number; latencyMs: number;
  ok: boolean; errorKind?: string;
}

export class LlmError extends Error {
  constructor(public kind: 'no_provider_allowed' | 'all_failed' | 'invalid_output' | 'unsupported', msg: string) { super(msg); }
}
