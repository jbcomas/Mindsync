import type { CallRecord, Gateway } from '@mindsync/llm';
import type { createTenantDb, Tx } from '@mindsync/db';

type Db = ReturnType<typeof createTenantDb>;

export interface ChunkHit {
  chunkId: string; sourceId: string; text: string; sourceKind: string; capturedAt: string; score: number;
}
export interface EntityHit {
  id: string; type: string; title: string; body: string | null; epistemicStatus: string; originKind: string;
  validationState: string; quote: string | null; sourceId: string | null; score: number;
}
export interface SearchResult { chunks: ChunkHit[]; entities: EntityHit[] }

const vec = (v: number[]) => `[${v.join(',')}]`;
const RRF_K = 60;

/** Convierte texto libre en un tsquery seguro (OR de palabras), sin interpretar operadores del usuario. */
export function toTsQuery(q: string): string | null {
  const words = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 24);
  return words.length ? words.join(' | ') : null;
}

/**
 * Búsqueda híbrida (docs/02 §3.2): vectorial + texto completo, fusionadas con Reciprocal Rank Fusion.
 * Todo corre dentro de withTenant: RLS limita el resultado al workspace del usuario y además se filtra explícito.
 */
export async function searchMemory(
  deps: { db: Db; gateway: Gateway },
  input: { userId: string; workspaceId: string; query: string; limit?: number; onCall?: (r: CallRecord) => void },
): Promise<SearchResult> {
  const limit = input.limit ?? 8;
  const [qv] = await deps.gateway.embed([input.query], 'personal', { onCall: input.onCall });
  const qvec = vec(qv!);
  const tsq = toTsQuery(input.query);

  return deps.db.withTenant(input.userId, async (tx: Tx) => {
    // HNSW con filtros: sin esto puede devolver menos resultados de los pedidos (docs/08 M-1).
    await tx.query("SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)");
    const ws = input.workspaceId;

    const byVector = (await tx.query(
      `SELECT c.id AS chunk_id, c.source_id, c.text, s.kind, s.captured_at
         FROM embeddings e
         JOIN chunks c  ON c.workspace_id = e.workspace_id AND c.id = e.chunk_id
         JOIN sources s ON s.workspace_id = c.workspace_id AND s.id = c.source_id
        WHERE e.workspace_id = $1 AND e.aspect = 'literal'
        ORDER BY e.vector <=> $2::vector LIMIT 30`, [ws, qvec])).rows;

    const byText = tsq ? (await tx.query(
      `SELECT c.id AS chunk_id, c.source_id, c.text, s.kind, s.captured_at
         FROM chunks c
         JOIN sources s ON s.workspace_id = c.workspace_id AND s.id = c.source_id,
              to_tsquery('simple', $2) q
        WHERE c.workspace_id = $1 AND c.tsv @@ q
        ORDER BY ts_rank(c.tsv, q) DESC LIMIT 30`, [ws, tsq])).rows : [];

    const fused = new Map<string, ChunkHit>();
    for (const list of [byVector, byText]) {
      list.forEach((r: any, rank: number) => {
        const cur = fused.get(r.chunk_id) ?? { chunkId: r.chunk_id, sourceId: r.source_id, text: r.text, sourceKind: r.kind, capturedAt: new Date(r.captured_at).toISOString(), score: 0 };
        cur.score += 1 / (RRF_K + rank + 1);
        fused.set(r.chunk_id, cur);
      });
    }
    const chunks = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);

    // Entidades por su vista "abstracta" (idea resumida), con la cita que las respalda.
    const ents = (await tx.query(
      `SELECT en.id, en.type, en.title, en.body, en.epistemic_status, en.origin_kind, en.validation_state,
              (SELECT p.quote FROM provenance p WHERE p.workspace_id = en.workspace_id AND p.entity_id = en.id AND p.quote IS NOT NULL LIMIT 1) AS quote,
              (SELECT p.source_id FROM provenance p WHERE p.workspace_id = en.workspace_id AND p.entity_id = en.id LIMIT 1) AS source_id,
              e.vector <=> $2::vector AS dist
         FROM embeddings e
         JOIN entities en ON en.workspace_id = e.workspace_id AND en.id = e.entity_id
        WHERE e.workspace_id = $1 AND e.aspect = 'abstract' AND en.validation_state <> 'rejected'
        ORDER BY e.vector <=> $2::vector LIMIT 8`, [ws, qvec])).rows;
    const entities: EntityHit[] = ents.map((r: any, i: number) => ({
      id: r.id, type: r.type, title: r.title, body: r.body, epistemicStatus: r.epistemic_status, originKind: r.origin_kind,
      validationState: r.validation_state, quote: r.quote, sourceId: r.source_id, score: 1 / (RRF_K + i + 1),
    }));
    return { chunks, entities };
  });
}
