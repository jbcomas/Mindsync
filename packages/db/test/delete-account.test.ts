import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTenantDb, urls } from '../src/index.js';

const db = createTenantDb(urls.app, { max: 3 });
const admin = new pg.Pool({ connectionString: urls.admin });
afterAll(async () => { await db.close(); await admin.end(); });

const em = () => `del-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
const vec = `[${Array(1024).fill(0.01).join(',')}]`;

/** Crea un usuario real (alta con passkey) y le llena TODAS las tablas de datos, en dos workspaces. */
async function seedUser() {
  const id = randomUUID(), email = em();
  await db.withoutTenant(tx => tx.query('SELECT ms_register_user_with_passkey($1,$2,$3,$4,0,$5,$6,true,$7,$8)',
    [id, email, randomBytes(24).toString('base64url'), randomBytes(77), ['internal'], 'multiDevice', 'Mac', [randomBytes(8).toString('hex'), randomBytes(8).toString('hex')]]));
  const wsPersonal = (await db.withTenant(id, async tx => (await tx.query("SELECT id FROM workspaces WHERE kind='personal'")).rows[0].id)) as string;
  const wsClient = await db.withTenant(id, async tx => {
    const w = (await tx.query("INSERT INTO workspaces(kind,name,created_by) VALUES ('client','Acme',$1) RETURNING id", [id])).rows[0].id as string;
    await tx.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [w, id]);
    return w;
  });
  // segundo passkey (para no depender de que sea el único)
  await db.withTenant(id, tx => tx.query("INSERT INTO passkeys(user_id,credential_id,public_key,device_type,backed_up) VALUES ($1,$2,$3,'singleDevice',false)", [id, randomBytes(8).toString('base64url'), randomBytes(5)]));
  for (const ws of [wsPersonal, wsClient]) await db.withTenant(id, async tx => {
    const src = (await tx.query("INSERT INTO sources(workspace_id,owner_id,kind,sha256) VALUES ($1,$2,'text',$3) RETURNING id", [ws, id, randomBytes(8).toString('hex')])).rows[0].id;
    const ch = (await tx.query("INSERT INTO chunks(workspace_id,source_id,text) VALUES ($1,$2,'hola mundo') RETURNING id", [ws, src])).rows[0].id;
    const ent = async (t: string) => (await tx.query(`INSERT INTO entities(workspace_id,owner_id,type,title,created_by_kind,origin_kind,epistemic_status) VALUES ($1,$2,'idea',$3,'ai','derived','claim') RETURNING id`, [ws, id, t])).rows[0].id as string;
    const [e1, e2] = [await ent('uno'), await ent('dos')];
    await tx.query("INSERT INTO relations(workspace_id,from_id,to_id,kind,created_by_kind) VALUES ($1,$2,$3,'relates_to','ai')", [ws, e1, e2]);
    await tx.query('INSERT INTO provenance(workspace_id,entity_id,source_id,chunk_id,quote) VALUES ($1,$2,$3,$4,$5)', [ws, e1, src, ch, 'hola']);
    await tx.query("INSERT INTO entity_history(workspace_id,entity_id,version,diff,changed_by) VALUES ($1,$2,1,'{}','ai')", [ws, e1]);
    await tx.query("INSERT INTO embeddings(workspace_id,chunk_id,aspect,model,vector) VALUES ($1,$2,'literal','m',$3::vector)", [ws, ch, vec]);
    await tx.query("INSERT INTO embeddings(workspace_id,entity_id,aspect,model,vector) VALUES ($1,$2,'abstract','m',$3::vector)", [ws, e1, vec]);
    await tx.query("INSERT INTO llm_calls(workspace_id,task,provider,model,data_class,ok,source_id) VALUES ($1,'extract','p','m','personal',true,$2)", [ws, src]);
    await tx.query("INSERT INTO audit_log(workspace_id,actor_id,actor_kind,action) VALUES ($1,$2,'user','seed')", [ws, id]);
  });
  return { id, email, wsPersonal, wsClient };
}

/** Cuenta, para cada tabla pública, las filas que referencian a un usuario (cualquier columna uuid) o a sus workspaces. */
async function traces(userId: string, workspaces: string[]) {
  const cols = (await admin.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND data_type='uuid' AND table_name <> 'schema_migrations'`)).rows as { table_name: string; column_name: string }[];
  const found: Record<string, number> = {};
  for (const { table_name: t, column_name: c } of cols) {
    const r = await admin.query(`SELECT count(*)::int n FROM "${t}" WHERE "${c}" = $1 OR "${c}" = ANY($2::uuid[])`, [userId, workspaces]);
    if (r.rows[0].n) found[`${t}.${c}`] = r.rows[0].n;
  }
  return found;
}
const snapshot = async (userId: string) => (await admin.query(`
  SELECT (SELECT count(*) FROM sources WHERE owner_id=$1)::int s, (SELECT count(*) FROM entities WHERE owner_id=$1)::int e,
         (SELECT count(*) FROM passkeys WHERE user_id=$1)::int p, (SELECT count(*) FROM recovery_codes WHERE user_id=$1)::int rc,
         (SELECT count(*) FROM memberships WHERE user_id=$1)::int m`, [userId])).rows[0];
const del = (userId: string) => db.withTenant(userId, async tx => (await tx.query('SELECT ms_delete_account() AS r')).rows[0].r);

describe('borrado completo de la cuenta', () => {
  it('borra TODO rastro del usuario (todas las tablas, cualquier columna uuid) y devuelve los conteos', async () => {
    const A = await seedUser();
    const before = await traces(A.id, [A.wsPersonal, A.wsClient]);
    expect(Object.keys(before).length).toBeGreaterThan(10);   // el seed realmente tocó muchas tablas

    const r = await del(A.id);
    expect(r).toEqual({ workspaces: 2, sources: 2, entities: 4, passkeys: 2 });
    expect(await traces(A.id, [A.wsPersonal, A.wsClient])).toEqual({});
    expect((await admin.query('SELECT 1 FROM users WHERE id=$1 OR email=$2', [A.id, A.email])).rowCount).toBe(0);
  });

  it('no toca a otros usuarios', async () => {
    const A = await seedUser(), B = await seedUser();
    const [bBefore, bTraces] = [await snapshot(B.id), await traces(B.id, [B.wsPersonal, B.wsClient])];
    await del(A.id);
    expect(await snapshot(B.id)).toEqual(bBefore);
    expect(await traces(B.id, [B.wsPersonal, B.wsClient])).toEqual(bTraces);
    // y B puede seguir leyendo todo lo suyo
    expect(await db.withTenant(B.id, async tx => (await tx.query('SELECT count(*)::int n FROM entities')).rows[0].n)).toBe(4);
  });

  it('solo puede borrar al usuario de la sesión: no existe forma de pedir que borre a otro', async () => {
    const A = await seedUser(), B = await seedUser();
    await del(B.id);                                           // B borra su cuenta
    expect((await admin.query('SELECT 1 FROM users WHERE id=$1', [A.id])).rowCount).toBe(1);
    expect((await traces(A.id, [A.wsPersonal, A.wsClient]))['entities.owner_id']).toBe(4);
    const fn = (await admin.query("SELECT pronargs FROM pg_proc WHERE proname='ms_delete_account'")).rows[0];
    expect(fn.pronargs).toBe(0);                               // sin parámetro de usuario
  });

  it('sin identidad no hace nada; una cuenta ya borrada no se puede borrar de nuevo', async () => {
    await expect(db.withoutTenant(tx => tx.query('SELECT ms_delete_account()'))).rejects.toThrow(/no_user_context/);
    const A = await seedUser(); await del(A.id);
    await expect(del(A.id)).rejects.toThrow(/no_such_user/);
  });

  it('deja una constancia SIN datos personales ni referencias al usuario', async () => {
    const A = await seedUser(); await del(A.id);
    const cols = (await admin.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='account_deletions' ORDER BY 1")).rows;
    expect(cols.map(c => c.column_name)).toEqual(['deleted_at', 'entities', 'id', 'passkeys', 'sources', 'workspaces']);
    expect((await admin.query('SELECT count(*)::int n FROM account_deletions')).rows[0].n).toBeGreaterThan(0);
    // la app no puede ni leer ni escribir la constancia
    await expect(db.withoutTenant(tx => tx.query('SELECT 1 FROM account_deletions'))).rejects.toThrow(/permission denied/);
    await expect(db.withoutTenant(tx => tx.query('INSERT INTO account_deletions(workspaces,sources,entities,passkeys) VALUES (1,1,1,1)'))).rejects.toThrow(/permission denied|row-level/);
  });

  it('es atómico: si un workspace propio tiene otros miembros, se rechaza y NO se borra nada', async () => {
    const A = await seedUser(), B = await seedUser();
    await admin.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [A.wsClient, B.id]);   // A comparte su workspace con B
    const before = await traces(A.id, [A.wsPersonal, A.wsClient]);
    await expect(del(A.id)).rejects.toThrow(/workspace_shared/);
    expect(await traces(A.id, [A.wsPersonal, A.wsClient])).toEqual(before);          // ni siquiera el workspace personal se tocó
    expect((await admin.query('SELECT 1 FROM users WHERE id=$1', [A.id])).rowCount).toBe(1);
  });

  it('si solo es miembro de un workspace ajeno, solo se le quita la membresía y el workspace ajeno sigue intacto', async () => {
    const A = await seedUser(), B = await seedUser();
    await admin.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'viewer')", [B.wsPersonal, A.id]);   // A es lector en el workspace de B
    const bTraces = await traces(B.id, [B.wsPersonal, B.wsClient]);
    await del(A.id);
    expect((await admin.query('SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2', [B.wsPersonal, A.id])).rowCount).toBe(0);
    expect((await admin.query('SELECT 1 FROM workspaces WHERE id=$1', [B.wsPersonal])).rowCount).toBe(1);
    // B queda exactamente igual, salvo que ya no figura la membresía de A (1 fila menos en memberships)
    expect(await traces(B.id, [B.wsPersonal, B.wsClient])).toEqual({ ...bTraces, 'memberships.workspace_id': bTraces['memberships.workspace_id']! - 1 });
  });

  it('si tiene contenido propio dentro de un workspace ajeno, se rechaza (no queda contenido huérfano)', async () => {
    const A = await seedUser(), B = await seedUser();
    await admin.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [B.wsPersonal, A.id]);
    await admin.query("INSERT INTO sources(workspace_id,owner_id,kind) VALUES ($1,$2,'text')", [B.wsPersonal, A.id]);
    await expect(del(A.id)).rejects.toThrow(/owns_shared_content/);
    expect((await admin.query('SELECT 1 FROM users WHERE id=$1', [A.id])).rowCount).toBe(1);
  });

  it('el usuario borrado no puede volver a entrar: su passkey y sus códigos ya no existen', async () => {
    const A = await seedUser();
    const cred = (await admin.query('SELECT credential_id FROM passkeys WHERE user_id=$1 LIMIT 1', [A.id])).rows[0].credential_id;
    await del(A.id);
    expect(await db.withoutTenant(async tx => (await tx.query('SELECT * FROM ms_passkey_lookup($1)', [cred])).rows)).toEqual([]);
    expect((await admin.query('SELECT 1 FROM recovery_codes WHERE user_id=$1', [A.id])).rowCount).toBe(0);
  });

  it('el mismo email se puede volver a registrar después, como cuenta nueva y vacía', async () => {
    const A = await seedUser(); await del(A.id);
    const id2 = randomUUID();
    await db.withoutTenant(tx => tx.query('SELECT ms_register_user_with_passkey($1,$2,$3,$4,0,$5,$6,true,$7,$8)',
      [id2, A.email, randomBytes(24).toString('base64url'), randomBytes(77), [], 'singleDevice', 'Nuevo', [randomBytes(8).toString('hex')]]));
    expect(await db.withTenant(id2, async tx => (await tx.query('SELECT count(*)::int n FROM entities')).rows[0].n)).toBe(0);
  });
});
