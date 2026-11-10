import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createTenantDb, urls } from '../src/index.js';

// Todos los tests de aislamiento corren como ms_app (sin BYPASSRLS), nunca como dueño (docs/08 C-1).
const db = createTenantDb(urls.app, { max: 1 }); // max=1 fuerza reutilización de la MISMA conexión (C-2)
const admin = new pg.Pool({ connectionString: urls.admin }); // solo para fixtures y chequeos de catálogo

let A: string, B: string; // usuarios
let wsA: string, wsB: string, wsA2: string; // workspaces (A tiene dos)
let srcA: string, entA: string, entA2: string, entB: string;

const DATA_TABLES = ['sources', 'chunks', 'entities', 'entity_history', 'relations', 'provenance', 'embeddings', 'audit_log'];

beforeAll(async () => {
  const suffix = Date.now();
  const signup = (e: string) => db.withoutTenant(async tx => (await tx.query('SELECT ms_signup($1) AS id', [e])).rows[0].id as string);
  A = await signup(`a-${suffix}@test.local`);
  B = await signup(`b-${suffix}@test.local`);
  wsA = await db.withTenant(A, async tx => (await tx.query("SELECT id FROM workspaces WHERE kind='personal'")).rows[0].id);
  wsB = await db.withTenant(B, async tx => (await tx.query("SELECT id FROM workspaces WHERE kind='personal'")).rows[0].id);
  // A crea un segundo workspace (cliente) legítimamente
  wsA2 = await db.withTenant(A, async tx => {
    const w = (await tx.query("INSERT INTO workspaces(kind,name,created_by) VALUES ('client','Acme',$1) RETURNING id", [A])).rows[0].id;
    await tx.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [w, A]);
    return w;
  });
  const mkEntity = (tx: any, ws: string, uid: string, title: string) =>
    tx.query(`INSERT INTO entities(workspace_id,owner_id,type,title,created_by_kind,origin_kind,epistemic_status)
              VALUES ($1,$2,'idea',$3,'user','own_thought','claim') RETURNING id`, [ws, uid, title]).then((r: any) => r.rows[0].id as string);
  await db.withTenant(A, async tx => {
    srcA = (await tx.query("INSERT INTO sources(workspace_id,owner_id,kind) VALUES ($1,$2,'text') RETURNING id", [wsA, A])).rows[0].id;
    await tx.query("INSERT INTO chunks(workspace_id,source_id,text) VALUES ($1,$2,'secreto de A: roadmap')", [wsA, srcA]);
    entA = await mkEntity(tx, wsA, A, 'idea privada de A');
    entA2 = await mkEntity(tx, wsA2, A, 'idea del cliente Acme');
    await tx.query("INSERT INTO audit_log(workspace_id,actor_id,actor_kind,action) VALUES ($1,$2,'user','test.seed')", [wsA, A]);
  });
  await db.withTenant(B, async tx => { entB = await mkEntity(tx, wsB, B, 'idea privada de B'); });
});

afterAll(async () => { await db.close(); await admin.end(); });

describe('roles y catálogo (C-1)', () => {
  it('ms_app no es superusuario ni BYPASSRLS', async () => {
    const r = await db.withTenant(A, tx => tx.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'));
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('toda tabla de public con datos tiene RLS habilitado, FORZADO y al menos una política', async () => {
    const r = await admin.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)::int AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> 'schema_migrations'`);
    const bad = r.rows.filter(x => !x.relrowsecurity || !x.relforcerowsecurity || x.policies < 1).map(x => x.relname);
    expect(bad).toEqual([]);
  });

  it('las tablas con workspace_id usan PK/FK compuestas (A-1): no hay FK simple a entities/sources/chunks', async () => {
    const r = await admin.query(`
      SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE contype='f' AND confrelid::regclass::text IN ('entities','sources','chunks')
        AND array_length(conkey,1) = 1`);
    expect(r.rows).toEqual([]);
  });
});

describe('sin contexto de tenant', () => {
  it('sin app.user_id no se ve ninguna fila en ninguna tabla (fail closed)', async () => {
    for (const t of [...DATA_TABLES, 'workspaces', 'memberships', 'users']) {
      const n = await db.withoutTenant(async tx => (await tx.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
      expect(n, t).toBe(0);
    }
  });

  it('el contexto de una transacción NO se filtra a la siguiente sobre la misma conexión (C-2)', async () => {
    const seen = await db.withTenant(A, async tx => (await tx.query('SELECT count(*)::int AS n FROM entities')).rows[0].n);
    expect(seen).toBeGreaterThan(0);
    const after = await db.withoutTenant(async tx => (await tx.query("SELECT current_setting('app.user_id', true) AS v, (SELECT count(*)::int FROM entities) AS n")).rows[0]);
    expect(after.n).toBe(0);
    expect(after.v === null || after.v === '').toBe(true);
  });

  it('un error dentro de la transacción tampoco deja contexto residual', async () => {
    await expect(db.withTenant(A, async tx => { await tx.query('SELECT 1/0'); })).rejects.toThrow();
    const n = await db.withoutTenant(async tx => (await tx.query('SELECT count(*)::int AS n FROM entities')).rows[0].n);
    expect(n).toBe(0);
  });
});

describe('B no ve nada de A (por tabla)', () => {
  for (const t of DATA_TABLES) {
    it(`SELECT sobre ${t}`, async () => {
      const rows = await db.withTenant(B, async tx => (await tx.query(`SELECT workspace_id FROM ${t}`)).rows);
      expect(rows.every((r: any) => r.workspace_id === wsB)).toBe(true);
    });
  }

  it('búsqueda de texto no devuelve chunks de A', async () => {
    const r = await db.withTenant(B, tx => tx.query("SELECT text FROM chunks WHERE tsv @@ plainto_tsquery('simple','secreto')"));
    expect(r.rows).toEqual([]);
  });

  it('count(*) no revela existencia', async () => {
    const n = await db.withTenant(B, async tx => (await tx.query("SELECT count(*)::int AS n FROM entities WHERE title LIKE '%A%'")).rows[0].n);
    expect(n).toBe(0); // 'idea privada de B' no contiene 'A' mayúscula
  });

  it('no puede ver workspaces, membresías ni usuarios de A', async () => {
    const r = await db.withTenant(B, async tx => ({
      ws: (await tx.query('SELECT id FROM workspaces')).rows.map((x: any) => x.id),
      m: (await tx.query('SELECT user_id FROM memberships')).rows.map((x: any) => x.user_id),
      u: (await tx.query('SELECT id FROM users')).rows.map((x: any) => x.id),
    }));
    expect(r.ws).toEqual([wsB]);
    expect(r.m).toEqual([B]);
    expect(r.u).toEqual([B]);
  });

  it('UPDATE y DELETE sobre filas de A afectan 0 filas', async () => {
    const r = await db.withTenant(B, async tx => ({
      up: (await tx.query("UPDATE entities SET title='hackeado' WHERE id=$1", [entA])).rowCount,
      del: (await tx.query('DELETE FROM entities WHERE id=$1', [entA])).rowCount,
    }));
    expect(r).toEqual({ up: 0, del: 0 });
    const t = await db.withTenant(A, async tx => (await tx.query('SELECT title FROM entities WHERE id=$1', [entA])).rows[0].title);
    expect(t).toBe('idea privada de A');
  });
});

describe('escritura (WITH CHECK)', () => {
  it('B no puede insertar filas en el workspace de A', async () => {
    await expect(db.withTenant(B, tx => tx.query(
      `INSERT INTO entities(workspace_id,owner_id,type,title,created_by_kind,origin_kind,epistemic_status)
       VALUES ($1,$2,'idea','intruso','user','own_thought','claim')`, [wsA, B]))).rejects.toThrow(/row-level security/);
  });

  it('B no puede auto-agregarse como miembro del workspace de A', async () => {
    await expect(db.withTenant(B, tx => tx.query(
      "INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [wsA, B]))).rejects.toThrow(/row-level security/);
  });

  it('B no puede crear un workspace a nombre de A', async () => {
    await expect(db.withTenant(B, tx => tx.query(
      "INSERT INTO workspaces(kind,name,created_by) VALUES ('team','x',$1)", [A]))).rejects.toThrow(/row-level security/);
  });

  it('un usuario no puede mover una fila a otro workspace (UPDATE workspace_id)', async () => {
    await expect(db.withTenant(B, tx => tx.query('UPDATE entities SET workspace_id=$1 WHERE id=$2', [wsA, entB]))).rejects.toThrow();
  });
});

describe('FK compuestas entre workspaces (A-1)', () => {
  it('ni siquiera el mismo usuario puede relacionar entidades de dos workspaces suyos', async () => {
    await expect(db.withTenant(A, tx => tx.query(
      "INSERT INTO relations(workspace_id,from_id,to_id,kind,created_by_kind) VALUES ($1,$2,$3,'related','user')",
      [wsA, entA, entA2]))).rejects.toThrow(/foreign key/);
  });

  it('A no puede enlazar una entidad suya con una de B', async () => {
    await expect(db.withTenant(A, tx => tx.query(
      "INSERT INTO relations(workspace_id,from_id,to_id,kind,created_by_kind) VALUES ($1,$2,$3,'related','user')",
      [wsA, entA, entB]))).rejects.toThrow(/foreign key/);
  });

  it('el workspace Acme de A es invisible desde su workspace personal solo si el cliente filtra (ambos son visibles a A)', async () => {
    const ws = await db.withTenant(A, async tx => (await tx.query('SELECT id FROM workspaces ORDER BY created_at')).rows.map((r: any) => r.id));
    expect(ws).toEqual([wsA, wsA2]);
  });
});

describe('invariantes de procedencia (ADR-0002)', () => {
  const ins = (tx: any, fields: Record<string, string>) => tx.query(
    `INSERT INTO entities(workspace_id,owner_id,type,title,created_by_kind,origin_kind,epistemic_status,validation_state)
     VALUES ($1,$2,'idea','x',$3,$4,$5,$6)`,
    [wsA, A, fields.by, fields.origin, fields.epi, fields.val]);

  it('la IA no puede crear una idea como propia', async () => {
    await expect(db.withTenant(A, tx => ins(tx, { by: 'ai', origin: 'own_thought', epi: 'proposal', val: 'unreviewed' }))).rejects.toThrow(/ai_cannot_claim_ownership/);
  });
  it('la IA no puede crear algo ya confirmado', async () => {
    await expect(db.withTenant(A, tx => ins(tx, { by: 'ai', origin: 'ai_generated', epi: 'proposal', val: 'confirmed' }))).rejects.toThrow(/ai_cannot_claim_ownership/);
  });
  it('la IA sí puede crear una propuesta sin revisar', async () => {
    await expect(db.withTenant(A, tx => ins(tx, { by: 'ai', origin: 'ai_generated', epi: 'proposal', val: 'unreviewed' }))).resolves.toBeDefined();
  });
});

describe('auditoría append-only con hash encadenado (A-8)', () => {
  it('la app no puede UPDATE ni DELETE', async () => {
    await expect(db.withTenant(A, tx => tx.query("UPDATE audit_log SET action='x'"))).rejects.toThrow(/permission denied/);
    await expect(db.withTenant(A, tx => tx.query('DELETE FROM audit_log'))).rejects.toThrow(/permission denied/);
  });
  it('seq es consecutivo y cada hash depende del anterior', async () => {
    await db.withTenant(A, async tx => {
      await tx.query("INSERT INTO audit_log(workspace_id,actor_id,actor_kind,action) VALUES ($1,$2,'user','test.two')", [wsA, A]);
    });
    const rows = await db.withTenant(A, async tx => (await tx.query('SELECT seq, prev_hash, hash FROM audit_log WHERE workspace_id=$1 ORDER BY seq', [wsA])).rows);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    rows.forEach((r: any, i: number) => {
      expect(Number(r.seq)).toBe(i + 1);
      if (i > 0) expect(Buffer.compare(r.prev_hash, rows[i - 1].hash)).toBe(0);
    });
    expect(new Set(rows.map((r: any) => r.hash.toString('hex'))).size).toBe(rows.length);
  });
});

describe('entrada inválida', () => {
  it('withTenant rechaza un userId malformado (no se interpola nunca en SQL)', async () => {
    await expect(db.withTenant("x'; drop table users;--", async () => 1)).rejects.toThrow(/inválido/);
  });
});
