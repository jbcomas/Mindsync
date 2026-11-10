import { createGateway, type GatewayConfig } from './gateway.js';
import { anthropicProvider, geminiProvider, openAiCompatibleProvider } from './providers.js';
import type { LlmProvider } from './types.js';

/**
 * Configuración por defecto de desarrollo. Los IDs de modelo son un punto de partida:
 * se fijan definitivamente con los benchmarks de V0 (ver docs/05 D-06..D-08).
 * Solo se registran los proveedores cuyas credenciales existen.
 */
export function defaultGateway(onCall?: GatewayConfig['onCall']) {
  const providers: Record<string, LlmProvider> = {};
  if (process.env.ANTHROPIC_API_KEY) providers.anthropic = anthropicProvider();
  if (process.env.OPENAI_API_KEY) providers.openai = openAiCompatibleProvider();
  const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (hasGemini) providers.gemini = geminiProvider();
  if (process.env.OLLAMA_BASE_URL) providers.local = openAiCompatibleProvider({ name: 'local', baseURL: process.env.OLLAMA_BASE_URL });

  const fast = { provider: 'anthropic', model: 'claude-haiku-5-5' };
  const mid = { provider: 'anthropic', model: 'claude-sonnet-5-5' };
  const strong = { provider: 'anthropic', model: 'claude-opus-5-5' };
  const fallbackOpenAi = { provider: 'openai', model: process.env.OPENAI_FALLBACK_MODEL ?? 'gpt-5' };
  // IDs verificados con llamadas reales (2026-11-10): models.list() NO es confiable (lista modelos 2.5 que devuelven 404 y
  // gemini-3.8-flash estaba saturado con 503). Sobrescribibles por entorno.
  const geminiFast = { provider: 'gemini', model: process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash-lite' };
  const geminiMid = { provider: 'gemini', model: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash' };
  const geminiStrong = { provider: 'gemini', model: process.env.GEMINI_STRONG_MODEL ?? 'gemini-3.7-flash' };
  const local = { provider: 'local', model: process.env.OLLAMA_MODEL ?? 'llama3.1' };

  return createGateway({
    providers,
    routes: {
      classify: [fast, geminiFast, local],
      extract: [mid, geminiMid, fallbackOpenAi, local],
      relate: [strong, mid, geminiStrong],
      ideate: [strong, mid, geminiStrong],
      write: [mid, geminiMid, fallbackOpenAi],
    },
    // 'restricted' solo a modelos locales (docs/06, ADR-0007).
    allowedProviders: { restricted: ['local'] },
    // Anthropic no ofrece embeddings: OpenAI si hay clave; si no, Gemini. La dimensión debe coincidir con embeddings.vector (1024).
    embedding: process.env.OPENAI_API_KEY || !hasGemini
      ? { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1024 }
      : { provider: 'gemini', model: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001', dimensions: 1024 },
    // Gemini entiende audio de forma nativa: transcripción sin servicio extra.
    transcription: hasGemini ? { provider: 'gemini', model: process.env.GEMINI_TRANSCRIBE_MODEL ?? 'gemini-3.5-flash' } : undefined,
    onCall,
  });
}
