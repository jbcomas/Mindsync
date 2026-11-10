import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantDb, urls } from '../src/index.js';

const db = createTenantDb(urls.app, { max: 2 });
let A: string, B: string, ws: string;
const q = (uid: string, sql: string, p: unknown[] = []) => db.withTenant(uid, async tx => (await tx.query(sql, p)).rows as any[]);
const aiEntity = (tx: any, extra = '') => tx.query(
  `INSERT INTO entities(workspace_id,owner_id,type,title,created_by_kind,origin_kind,epistemic_status) VALUES ($1,$2,'decision','d','ai','derived','claim') RETURNING id`, [ws, A]);

beforeAll(async () => {
  const s = Date.now();
  const signup = (e: string) => db.withoutTenant(async tx => (await tx.query('SELECT ms_signup($1) AS id', [e])).rows[0].id as string);
  A = await signup(`ra-${s}@test.local`); B = await signup(`rb-${s}@test.local`);
  ws = (await q(A, "SELECT id FROM workspaces WHERE kind='personal'"))[0].id;
});
afterAll(() => db.close());

describe('revisión por el usuario', () => {
  it('el usuario puede confirmar y marcar como decisión confirmada algo que extrajo la IA', async () => {
    const id = (await db.withTenant(A, async tx => (await aiEntity(tx)).rows[0].id)) as string;
    await db.withTenant(A, tx => tx.query(
      `UPDATE entities SET validation_state='confirmed', epistemic_status='decision_confirmed', reviewed_by_kind='user', reviewed_at=now() WHERE workspace_id=$1 AND id=$2`, [ws, id]));
    expect((await q(A, 'SELECT validation_state, epistemic_status FROM entities WHERE id=$1', [id]))[0]).toEqual({ validation_state: 'confirmed', epistemic_status: 'decision_confirmed' });
  });

  it('un estado de revisión sin reviewed_by_kind=user es rechazado por la base', async () => {
    const id = (await db.withTenant(A, async tx => (await aiEntity(tx)).rows[0].id)) as string;
    await expect(db.withTenant(A, tx => tx.query(`UPDATE entities SET validation_state='confirmed' WHERE workspace_id=$1 AND id=$2`, [ws, id]))).rejects.toThrow(/review_requires_user/);
    await expect(db.withTenant(A, tx => tx.query(`UPDATE entities SET epistemic_status='decision_confirmed' WHERE workspace_id=$1 AND id=$2`, [ws, id]))).rejects.toThrow(/review_requires_user/);
  });

  it('la IA sigue sin poder INSERTAR algo confirmado, propio o decisión confirmada', async () => {
    for (const [origin, val, epi] of [['own_thought', 'unreviewed', 'claim'], ['derived', 'confirmed', 'claim'], ['derived', 'unreviewed', 'decision_confirmed']]) {
      await expect(db.withTenant(A, tx => tx.query(
        `INSERT INTO entities(workspace_id,owner_id,type,title,created_by_kind,origin_kind,epistemic_status,validation_state,reviewed_by_kind)
         VALUES ($1,$2,'idea','x','ai',$3,$4,$5,'user')`, [ws, A, origin, epi, val]))).rejects.toThrow(/ai_cannot_claim_ownership/);
    }
  });

  it('B no puede revisar entidades de A', async () => {
    const id = (await db.withTenant(A, async tx => (await aiEntity(tx)).rows[0].id)) as string;
    const n = await db.withTenant(B, async tx => (await tx.query(`UPDATE entities SET validation_state='rejected', reviewed_by_kind='user' WHERE id=$1`, [id])).rowCount);
    expect(n).toBe(0);
  });
});

describe('borrado de una fuente (E6)', () => {
  it('borra la fuente, sus chunks, embeddings y las entidades que quedan sin procedencia; conserva las que tienen otra fuente', async () => {
    const r = await db.withTenant(A, async tx => {
      const mk = async () => (await tx.query("INSERT INTO sources(workspace_id,owner_id,kind) VALUES ($1,$2,'text') RETURNING id", [ws, A])).rows[0].id as string;
      const s1 = await mk(), s2 = await mk();
      const ent = async (t: string) => (await tx.query(`INSERT INTO entities(workspace_id,owner_id,type,title,created_by_kind,origin_kind,epistemic_status) VALUES ($1,$2,'idea',$3,'ai','derived','claim') RETURNING id`, [ws, A, t])).rows[0].id as string;
      const only1 = await ent('solo-fuente-1'), both = await ent('en-ambas');
      const ch = (await tx.query("INSERT INTO chunks(workspace_id,source_id,text) VALUES ($1,$2,'hola') RETURNING id", [ws, s1])).rows[0].id as string;
      await tx.query(`INSERT INTO embeddings(workspace_id,chunk_id,aspect,model,vector) VALUES ($1,$2,'literal','m',$3::vector)`, [ws, ch, `[${Array(1024).fill(0.01).join(',')}]`]);
      for (const [e, s] of [[only1, s1], [both, s1], [both, s2]]) await tx.query('INSERT INTO provenance(workspace_id,entity_id,source_id) VALUES ($1,$2,$3)', [ws, e, s]);
      return { s1, only1, both };
    });
    const deleted = (await q(A, 'SELECT ms_delete_source($1,$2) AS n', [ws, r.s1]))[0].n;
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await q(A, 'SELECT 1 FROM entities WHERE id=$1', [r.only1])).toHaveLength(0);
    expect(await q(A, 'SELECT 1 FROM entities WHERE id=$1', [r.both])).toHaveLength(1);
    expect(await q(A, 'SELECT 1 FROM chunks WHERE source_id=$1', [r.s1])).toHaveLength(0);
    expect((await q(A, 'SELECT count(*)::int n FROM embeddings WHERE chunk_id IS NOT NULL AND workspace_id=$1 AND model=$2', [ws, 'm']))[0].n).toBe(0);
  });

  it('B no puede borrar fuentes de A', async () => {
    const s = (await db.withTenant(A, async tx => (await tx.query("INSERT INTO sources(workspace_id,owner_id,kind) VALUES ($1,$2,'text') RETURNING id", [ws, A])).rows[0].id)) as string;
    expect((await q(B, 'SELECT ms_delete_source($1,$2) AS n', [ws, s]))[0].n).toBe(0);
    expect(await q(A, 'SELECT 1 FROM sources WHERE id=$1', [s])).toHaveLength(1);
  });
});
