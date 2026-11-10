import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTenantDb, urls } from '../src/index.js';

const db = createTenantDb(urls.app, { max: 2 });
const admin = new pg.Pool({ connectionString: urls.admin });
afterAll(async () => { await db.close(); await admin.end(); });

const em = () => `pk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
const hash = () => randomBytes(16).toString('hex');
async function register(email = em(), opts: { cred?: string; hashes?: string[]; id?: string } = {}) {
  const id = opts.id ?? randomUUID(), cred = opts.cred ?? randomBytes(24).toString('base64url');
  await db.withoutTenant(tx => tx.query(
    'SELECT ms_register_user_with_passkey($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, email, cred, randomBytes(77), 0, ['internal'], 'multiDevice', true, 'Mi Mac', opts.hashes ?? [hash(), hash()]]));
  return { id, email, cred };
}
const q = (uid: string, sql: string, p: unknown[] = []) => db.withTenant(uid, async tx => (await tx.query(sql, p)).rows as any[]);

describe('registro', () => {
  it('crea usuario + workspace personal + membresía + passkey + códigos, todo junto', async () => {
    const hashes = [hash(), hash(), hash()];
    const u = await register(em(), { hashes });
    expect(await q(u.id, "SELECT kind FROM workspaces")).toEqual([{ kind: 'personal' }]);
    expect((await q(u.id, 'SELECT name, device_type, counter FROM passkeys'))[0]).toMatchObject({ name: 'Mi Mac', device_type: 'multiDevice', counter: '0' });
    expect(await q(u.id, 'SELECT 1 FROM recovery_codes')).toHaveLength(3);
  });

  it('un email ya registrado NO recibe un passkey nuevo (impide tomar una cuenta ajena) y no deja basura', async () => {
    const a = await register();
    // El mensaje es 'email_taken' pero el SQLSTATE debe seguir siendo 23505 (unique_violation): la API se apoya en ese código.
    await expect(register(a.email.toUpperCase())).rejects.toMatchObject({ code: '23505', message: expect.stringMatching(/email_taken/) });
    expect(await q(a.id, 'SELECT 1 FROM passkeys')).toHaveLength(1);
    const orphans = await admin.query("SELECT count(*)::int n FROM passkeys WHERE user_id NOT IN (SELECT id FROM users)");
    expect(orphans.rows[0].n).toBe(0);
  });

  it('es atómico: si falla a mitad (credencial repetida) no queda el usuario creado', async () => {
    const a = await register();
    const email = em();
    await expect(register(email, { cred: a.cred })).rejects.toThrow();
    expect((await admin.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount).toBe(0);
  });
});

describe('aislamiento', () => {
  it('B no ve, no modifica ni borra los passkeys ni los códigos de A', async () => {
    const A = await register(), B = await register();
    for (const t of ['passkeys', 'recovery_codes']) {
      expect((await q(B.id, `SELECT user_id FROM ${t}`)).every(r => r.user_id === B.id), t).toBe(true);
    }
    const r = await db.withTenant(B.id, async tx => ({
      up: (await tx.query("UPDATE passkeys SET name='robado' WHERE user_id=$1", [A.id])).rowCount,
      del: (await tx.query('DELETE FROM passkeys WHERE user_id=$1', [A.id])).rowCount,
      delc: (await tx.query('DELETE FROM recovery_codes WHERE user_id=$1', [A.id])).rowCount,
    }));
    expect(r).toEqual({ up: 0, del: 0, delc: 0 });
  });

  it('un usuario no puede insertar un passkey a nombre de otro', async () => {
    const A = await register(), B = await register();
    await expect(db.withTenant(B.id, tx => tx.query(
      "INSERT INTO passkeys(user_id, credential_id, public_key, device_type, backed_up) VALUES ($1,$2,$3,'singleDevice',false)", [A.id, randomBytes(8).toString('base64url'), randomBytes(5)]))).rejects.toThrow(/row-level security/);
  });

  it('el usuario no puede alterar contador ni clave pública (solo el nombre)', async () => {
    const A = await register();
    await expect(db.withTenant(A.id, tx => tx.query('UPDATE passkeys SET counter = 999 WHERE user_id=$1', [A.id]))).rejects.toThrow(/permission denied/);
    await expect(db.withTenant(A.id, tx => tx.query("UPDATE passkeys SET public_key = '\\x00' WHERE user_id=$1", [A.id]))).rejects.toThrow(/permission denied/);
    await db.withTenant(A.id, tx => tx.query("UPDATE passkeys SET name='Otro nombre' WHERE user_id=$1", [A.id]));
    expect((await q(A.id, 'SELECT name FROM passkeys'))[0].name).toBe('Otro nombre');
  });

  it('sin contexto de usuario no se ve ningún passkey ni código', async () => {
    await register();
    for (const t of ['passkeys', 'recovery_codes'])
      expect((await db.withoutTenant(async tx => (await tx.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n)), t).toBe(0);
  });
});

describe('login (funciones privilegiadas)', () => {
  it('ms_passkey_lookup encuentra por credential id y devuelve el dueño; desconocido => vacío', async () => {
    const A = await register();
    const r = await db.withoutTenant(async tx => (await tx.query('SELECT * FROM ms_passkey_lookup($1)', [A.cred])).rows);
    expect(r).toHaveLength(1);
    expect(r[0].user_id).toBe(A.id);
    expect(await db.withoutTenant(async tx => (await tx.query("SELECT * FROM ms_passkey_lookup('no-existe')")).rows)).toEqual([]);
  });

  it('el contador solo avanza: un valor menor (credencial clonada) se rechaza', async () => {
    const A = await register();
    const touch = (n: number) => db.withoutTenant(async tx => (await tx.query('SELECT ms_passkey_touch($1,$2) AS ok', [A.cred, n])).rows[0].ok as boolean);
    expect(await touch(5)).toBe(true);
    expect(await touch(7)).toBe(true);
    expect(await touch(3)).toBe(false);
    expect((await q(A.id, 'SELECT counter FROM passkeys'))[0].counter).toBe('7');
  });

  it('un código de recuperación sirve una sola vez, y solo para su email', async () => {
    const h = hash();
    const A = await register(em(), { hashes: [h, hash()] }), B = await register();
    const login = (email: string, hh: string) => db.withoutTenant(async tx => (await tx.query('SELECT ms_recovery_login($1,$2) AS u', [email, hh])).rows[0].u as string | null);
    expect(await login(B.email, h)).toBeNull();          // el código de A no sirve para B
    expect(await login(A.email, h)).toBe(A.id);          // sí para A
    expect(await login(A.email, h)).toBeNull();          // pero una sola vez
    expect(await login(A.email, hash())).toBeNull();     // código inexistente
    expect(await login('nadie@test.local', h)).toBeNull();
  });
});

describe('último passkey', () => {
  it('no se puede borrar el único passkey; sí cuando hay otro', async () => {
    const A = await register();
    await expect(db.withTenant(A.id, tx => tx.query('DELETE FROM passkeys WHERE user_id=$1', [A.id]))).rejects.toThrow(/last_passkey/);
    await db.withTenant(A.id, tx => tx.query(
      "INSERT INTO passkeys(user_id, credential_id, public_key, device_type, backed_up) VALUES ($1,$2,$3,'singleDevice',false)", [A.id, randomBytes(8).toString('base64url'), randomBytes(5)]));
    await db.withTenant(A.id, tx => tx.query('DELETE FROM passkeys WHERE user_id=$1 AND credential_id=$2', [A.id, A.cred]));
    expect(await q(A.id, 'SELECT 1 FROM passkeys')).toHaveLength(1);
  });
  it('la protección no bloquea el borrado del usuario (cuando ya no tiene datos que lo referencien)', async () => {
    const A = await register();
    // El borrado completo de cuenta aún no existe (workspaces/sources/entities referencian al usuario sin cascada): ver backlog US-6.5.
    await admin.query('DELETE FROM workspaces WHERE created_by = $1', [A.id]);
    await admin.query('DELETE FROM users WHERE id = $1', [A.id]);
    expect((await admin.query('SELECT 1 FROM passkeys WHERE user_id=$1', [A.id])).rowCount).toBe(0);
  });
});

describe('login de desarrollo eliminado', () => {
  it('ms_dev_login ya no existe en la base', async () => {
    const r = await admin.query("SELECT 1 FROM pg_proc WHERE proname = 'ms_dev_login'");
    expect(r.rowCount).toBe(0);
  });
});
