import { createHash } from 'node:crypto';
import type { CallRecord, DataClass, Gateway } from '@mindsync/llm';
import type { createTenantDb, Tx } from '@mindsync/db';
import { chunkText } from './chunk.js';
import { extractChunk, type ExtractedItem } from './extract.js';

type Db = ReturnType<typeof createTenantDb>;

export type SourceKind = 'text' | 'voice' | 'audio' | 'document' | 'web' | 'meeting' | 'ai_conversation' | 'import';

export interface IngestInput {
  userId: string;
  workspaceId: string;
  kind: SourceKind;
  text: string;
  context?: Record<string, unknown>;
  /** Nombre con el que el usuario aparece en una transcripción (para distinguir ideas propias de ajenas). */
  selfSpeaker?: string;
  /** Obligatorio para reuniones: el usuario declara que obtuvo el consentimiento (docs/legal §2.3). */
  consentDeclared?: boolean;
  dataClass?: DataClass;
}

export interface IngestResult {
  sourceId: string; deduped: boolean; chunks: number; entities: number; relations: number;
  droppedQuotes: number; status: 'done' | 'skipped';
}

const vec = (v: number[]) => `[${v.join(',')}]`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Ingestión de una fuente de texto (o transcripción) a conocimiento con procedencia.
 * Las llamadas a LLM ocurren FUERA de transacciones de DB (no se retienen conexiones durante segundos).
 */
export async function ingestText(deps: { db: Db; gateway: Gateway }, input: IngestInput): Promise<IngestResult> {
  const { db, gateway } = deps;
  const dataClass = input.dataClass ?? 'personal';
  if (!input.text.trim()) throw new Error('texto vacío');
  if (input.kind === 'meeting' && !input.consentDeclared) {
    throw new Error('Las reuniones requieren declarar el consentimiento de los participantes (docs/legal/consentimientos-v0.md §2.3)');
  }
  const hash = sha256(input.text);
  const chunks = chunkText(input.text);
  const calls: CallRecord[] = [];
  const onCall = (r: CallRecord) => { calls.push(r); };

  // ---- Tx 1: fuente + chunks + entidad raíz (creada por el usuario) ----
  const captured = await db.withTenant(input.userId, async tx => {
    const ins = await tx.query(
      `INSERT INTO sources(workspace_id, owner_id, kind, sha256, context, consent, ingestion_status)
       VALUES ($1,$2,$3,$4,$5,$6,'processing')
       ON CONFLICT (workspace_id, sha256) WHERE sha256 IS NOT NULL DO NOTHING RETURNING id`,
      [input.workspaceId, input.userId, input.kind, hash, JSON.stringify(input.context ?? {}),
       input.kind === 'meeting' ? JSON.stringify({ declared_by_user: true, at: new Date().toISOString() }) : null]);
    if (!ins.rowCount) {
      const ex = await tx.query('SELECT id, ingestion_status FROM sources WHERE workspace_id=$1 AND sha256=$2', [input.workspaceId, hash]);
      // Si quedó fallida/pendiente se reintenta; si está lista, es un duplicado.
      if (ex.rows[0]?.ingestion_status === 'failed') {
        await tx.query("UPDATE sources SET ingestion_status='processing', ingestion_error=NULL WHERE workspace_id=$1 AND id=$2", [input.workspaceId, ex.rows[0].id]);
        const c = await tx.query('SELECT id, text FROM chunks WHERE workspace_id=$1 AND source_id=$2 ORDER BY (locator->>\'start\')::int', [input.workspaceId, ex.rows[0].id]);
        return { sourceId: ex.rows[0].id as string, deduped: false, chunkRows: c.rows as { id: string; text: string }[], retry: true };
      }
      return { sourceId: ex.rows[0]?.id as string, deduped: true, chunkRows: [], retry: false };
    }
    const sourceId = ins.rows[0].id as string;
    const chunkRows: { id: string; text: string }[] = [];
    for (const c of chunks) {
      const r = await tx.query('INSERT INTO chunks(workspace_id, source_id, locator, text) VALUES ($1,$2,$3,$4) RETURNING id',
        [input.workspaceId, sourceId, JSON.stringify(c.locator), c.text]);
      chunkRows.push({ id: r.rows[0].id, text: c.text });
    }
    // Entidad raíz: la crea el usuario (no la IA), por eso puede ser "own_thought".
    const isMeeting = input.kind === 'meeting';
    const root = await tx.query(
      `INSERT INTO entities(workspace_id, owner_id, type, title, body, created_by_kind, origin_kind, epistemic_status)
       VALUES ($1,$2,$3,$4,$5,'user',$6,$7) RETURNING id`,
      [input.workspaceId, input.userId, isMeeting ? 'meeting' : 'thought', input.text.trim().slice(0, 80).replace(/\s+/g, ' '),
       isMeeting ? null : input.text, isMeeting ? 'imported' : 'own_thought', isMeeting ? 'observation' : 'claim']);
    await tx.query('INSERT INTO provenance(workspace_id, entity_id, source_id) VALUES ($1,$2,$3)', [input.workspaceId, root.rows[0].id, sourceId]);
    await audit(tx, input, 'source.captured', 'source', sourceId, { kind: input.kind, chunks: chunks.length });
    return { sourceId, deduped: false, chunkRows, retry: false };
  });

  if (captured.deduped) {
    return { sourceId: captured.sourceId, deduped: true, chunks: 0, entities: 0, relations: 0, droppedQuotes: 0, status: 'skipped' };
  }

  // ---- Fuera de transacción: embeddings + extracción ----
  try {
    const literalVecs = await gateway.embed(captured.chunkRows.map(c => c.text), dataClass, { onCall });

    const extracted: { chunkId: string; items: ExtractedItem[]; relations: { from: number; to: number; kind: string; rationale?: string }[] }[] = [];
    let droppedQuotes = 0;
    for (let i = 0; i < captured.chunkRows.length; i++) {
      const row = captured.chunkRows[i]!;
      const r = await extractChunk(gateway, { text: row.text, dataClass }, { onCall });
      droppedQuotes += r.droppedQuotes;
      extracted.push({ chunkId: row.id, items: r.items, relations: r.relations });
    }
    const allItems = extracted.flatMap(e => e.items);
    const abstractVecs = allItems.length
      ? await gateway.embed(allItems.map(i => `${i.title}. ${i.body ?? ''}`.trim()), dataClass, { onCall })
      : [];

    // ---- Tx 2: escribir todo de forma atómica ----
    const counts = await db.withTenant(input.userId, async tx => {
      let nEntities = 0, nRelations = 0, vi = 0;
      const ws = input.workspaceId;
      for (let i = 0; i < captured.chunkRows.length; i++) {
        await tx.query(`INSERT INTO embeddings(workspace_id, chunk_id, aspect, model, vector) VALUES ($1,$2,'literal',$3,$4::vector)`,
          [ws, captured.chunkRows[i]!.id, gateway.embeddingModel, vec(literalVecs[i]!)]);
      }
      const people = new Map<string, string>(); // lower(nombre) -> entity id
      const personFor = async (name: string) => {
        const key = name.trim().toLowerCase();
        if (people.has(key)) return people.get(key)!;
        const ex = await tx.query(`SELECT id FROM entities WHERE workspace_id=$1 AND type='person' AND lower(title)=$2 LIMIT 1`, [ws, key]);
        let id = ex.rows[0]?.id as string | undefined;
        if (!id) {
          id = (await tx.query(
            `INSERT INTO entities(workspace_id, owner_id, type, title, created_by_kind, origin_kind, epistemic_status, confidence)
             VALUES ($1,$2,'person',$3,'ai','derived','observation',0.6) RETURNING id`, [ws, input.userId, name.trim()])).rows[0].id;
          nEntities++;
          await history(tx, ws, id!, 'ai', { created: true });
        }
        people.set(key, id!);
        return id!;
      };

      for (const ex of extracted) {
        const ids: string[] = [];
        for (const it of ex.items) {
          const self = input.selfSpeaker?.trim().toLowerCase();
          const spk = it.speaker?.trim();
          const byOther = !!spk && !!self && spk.toLowerCase() !== self;
          const origin = byOther ? 'said_by_other' : 'derived';
          // Entidades de identidad (persona/org/proyecto/concepto): reutilizar si ya existe con el mismo título.
          let id: string | undefined;
          if (['person', 'organization', 'project', 'concept'].includes(it.type)) {
            const found = await tx.query(`SELECT id FROM entities WHERE workspace_id=$1 AND type=$2 AND lower(title)=lower($3) LIMIT 1`, [ws, it.type, it.title]);
            id = found.rows[0]?.id;
          }
          if (!id) {
            id = (await tx.query(
              `INSERT INTO entities(workspace_id, owner_id, type, title, body, created_by_kind, origin_kind, epistemic_status, confidence)
               VALUES ($1,$2,$3,$4,$5,'ai',$6,$7,$8) RETURNING id`,
              [ws, input.userId, it.type, it.title, it.body ?? null, origin, it.epistemic_status, it.confidence])).rows[0].id as string;
            nEntities++;
            await history(tx, ws, id, 'ai', { created: true, type: it.type });
            await tx.query(`INSERT INTO embeddings(workspace_id, entity_id, aspect, model, vector) VALUES ($1,$2,'abstract',$3,$4::vector)`,
              [ws, id, gateway.embeddingModel, vec(abstractVecs[vi]!)]);
          }
          vi++;
          ids.push(id);
          const asserted = byOther ? await personFor(spk!) : null;
          await tx.query(
            `INSERT INTO provenance(workspace_id, entity_id, source_id, chunk_id, quote, asserted_by_entity_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [ws, id, captured.sourceId, ex.chunkId, it.quote, asserted]);
        }
        for (const r of ex.relations) {
          await tx.query(
            `INSERT INTO relations(workspace_id, from_id, to_id, kind, created_by_kind, confidence, rationale) VALUES ($1,$2,$3,$4,'ai',0.5,$5)`,
            [ws, ids[r.from], ids[r.to], r.kind, r.rationale ?? null]);
          nRelations++;
        }
      }
      await recordCalls(tx, ws, calls, captured.sourceId);
      await tx.query("UPDATE sources SET ingestion_status='done', ingested_at=now() WHERE workspace_id=$1 AND id=$2", [ws, captured.sourceId]);
      await audit(tx, input, 'source.ingested', 'source', captured.sourceId, { entities: nEntities, relations: nRelations, droppedQuotes });
      return { nEntities, nRelations };
    });

    return { sourceId: captured.sourceId, deduped: false, chunks: captured.chunkRows.length, entities: counts.nEntities, relations: counts.nRelations, droppedQuotes, status: 'done' };
  } catch (e) {
    const kind = (e as { kind?: string }).kind ?? 'unexpected';
    await db.withTenant(input.userId, async tx => {
      await recordCalls(tx, input.workspaceId, calls, captured.sourceId);
      // Nunca se guarda el mensaje del error (puede contener contenido): solo su categoría.
      await tx.query("UPDATE sources SET ingestion_status='failed', ingestion_error=$3 WHERE workspace_id=$1 AND id=$2", [input.workspaceId, captured.sourceId, kind]);
      await audit(tx, input, 'source.ingest_failed', 'source', captured.sourceId, { kind });
    });
    throw e;
  }
}

async function history(tx: Tx, ws: string, entityId: string, by: 'user' | 'ai' | 'import', diff: object) {
  await tx.query('INSERT INTO entity_history(workspace_id, entity_id, version, diff, changed_by) VALUES ($1,$2,1,$3,$4)', [ws, entityId, JSON.stringify(diff), by]);
}

async function audit(tx: Tx, input: IngestInput, action: string, targetType: string, targetId: string, meta: object) {
  await tx.query('INSERT INTO audit_log(workspace_id, actor_id, actor_kind, action, target_type, target_id, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [input.workspaceId, input.userId, 'system', action, targetType, targetId, JSON.stringify(meta)]);
}

async function recordCalls(tx: Tx, ws: string, calls: CallRecord[], sourceId: string) {
  for (const c of calls) {
    await tx.query(
      `INSERT INTO llm_calls(workspace_id, task, provider, model, data_class, input_tokens, output_tokens, latency_ms, ok, error_kind, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ws, c.task, c.provider, c.model, c.dataClass, c.inputTokens ?? null, c.outputTokens ?? null, c.latencyMs, c.ok, c.errorKind ?? null, sourceId]);
  }
}
