import { afterAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTenantDb, urls } from '../src/index.js';

const db = createTenantDb(urls.app, { max: 3 });
const admin = new pg.Pool({ connectionString: urls.admin });
afterAll(async () => { await db.close(); await admin.end(); });

const em = () => `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
async function register(email = em()) {
  const id = randomUUID();
  await db.withoutTenant(tx => tx.query('SELECT ms_register_user_with_passkey($1,$2,$3,$4,0,$5,$6,true,$7,$8)',
    [id, email, randomBytes(24).toString('base64url'), randomBytes(77), [], 'multiDevice', 'Mac', [randomBytes(8).toString('hex')]]));
  return { id, email };
}
/** Emite un token para el usuario (como lo hace la API, con su propia identidad). */
async function issue(u: { id: string; email: string }, opts: { ttlMs?: number; email?: string } = {}) {
  const token = randomBytes(32).toString('base64url');
  await db.withTenant(u.id, tx => tx.query(
    `INSERT INTO email_verifications(user_id, email, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' milliseconds')::interval)`,
    [u.id, opts.email ?? u.email, sha(token), String(opts.ttlMs ?? 3600_000)]));
  return token;
}
const verify = (token: string) => db.withoutTenant(async tx => (await tx.query('SELECT ms_verify_email($1) AS u', [sha(token)])).rows[0].u as string | null);
const verified = async (id: string) => (await admin.query('SELECT email_verified_at FROM users WHERE id=$1', [id])).rows[0]?.email_verified_at != null;

describe('verificar un token', () => {
  it('un token válido verifica SOLO a su usuario', async () => {
    const A = await register(), B = await register();
    const t = await issue(A);
    expect(await verified(A.id)).toBe(false);
    expect(await verify(t)).toBe(A.id);
    expect(await verified(A.id)).toBe(true);
    expect(await verified(B.id)).toBe(false);
  });

  it('es de un solo uso', async () => {
    const A = await register(); const t = await issue(A);
    expect(await verify(t)).toBe(A.id);
    expect(await verify(t)).toBeNull();
  });

  it('un token vencido, desconocido o vacío no verifica', async () => {
    const A = await register();
    const expired = await issue(A, { ttlMs: -1000 });
    expect(await verify(expired)).toBeNull();
    expect(await verify(randomBytes(32).toString('base64url'))).toBeNull();
    expect(await verify('')).toBeNull();
    expect(await verified(A.id)).toBe(false);
  });

  it('un token emitido para otro email no vale si la cuenta cambió de email', async () => {
    const A = await register();
    const t = await issue(A, { email: 'otro-email@test.local' });      // emitido para un email que no es el actual
    expect(await verify(t)).toBeNull();
    expect(await verified(A.id)).toBe(false);
  });

  it('la base guarda solo el hash del token, nunca el token', async () => {
    const A = await register(); const t = await issue(A);
    const rows = (await admin.query('SELECT token_hash FROM email_verifications WHERE user_id=$1', [A.id])).rows;
    expect(rows[0].token_hash).toBe(sha(t));
    expect(JSON.stringify(rows)).not.toContain(t);
  });
});

describe('permisos y aislamiento', () => {
  it('la app NO puede marcar un email como verificado por su cuenta', async () => {
    const A = await register();
    await expect(db.withTenant(A.id, tx => tx.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [A.id]))).rejects.toThrow(/permission denied/);
    expect(await verified(A.id)).toBe(false);
  });

  it('B no ve, no crea ni borra tokens de A', async () => {
    const A = await register(), B = await register(); await issue(A);
    expect(await db.withTenant(B.id, async tx => (await tx.query('SELECT 1 FROM email_verifications')).rowCount)).toBe(0);
    await expect(db.withTenant(B.id, tx => tx.query(
      "INSERT INTO email_verifications(user_id,email,token_hash,expires_at) VALUES ($1,$2,'x', now() + interval '1 hour')", [A.id, A.email]))).rejects.toThrow(/row-level security/);
    expect(await db.withTenant(B.id, async tx => (await tx.query('DELETE FROM email_verifications WHERE user_id=$1', [A.id])).rowCount)).toBe(0);
  });

  it('sin identidad no se ve ningún token', async () => {
    const A = await register(); await issue(A);
    expect(await db.withoutTenant(async tx => (await tx.query('SELECT 1 FROM email_verifications')).rowCount)).toBe(0);
  });

  it('ms_email_verified() refleja el estado del usuario de la sesión', async () => {
    const A = await register();
    const is = () => db.withTenant(A.id, async tx => (await tx.query('SELECT ms_email_verified() AS v')).rows[0].v as boolean);
    expect(await is()).toBe(false);
    await verify(await issue(A));
    expect(await is()).toBe(true);
    expect(await db.withoutTenant(async tx => (await tx.query('SELECT ms_email_verified() AS v')).rows[0].v)).toBe(false);   // sin identidad
  });

  it('borrar la cuenta borra también sus tokens', async () => {
    const A = await register(); await issue(A);
    await db.withTenant(A.id, tx => tx.query('SELECT ms_delete_account()'));
    expect((await admin.query('SELECT 1 FROM email_verifications WHERE user_id=$1', [A.id])).rowCount).toBe(0);
  });

  it('ms_purge_user no es ejecutable por la app (solo lo usan otras funciones internas)', async () => {
    const A = await register();
    await expect(db.withTenant(A.id, tx => tx.query('SELECT ms_purge_user($1)', [A.id]))).rejects.toThrow(/permission denied/);
  });
});

describe('cuentas fantasma: registrar un email que otra persona reservó', () => {
  const ageHours = (id: string, h: number) => admin.query("UPDATE users SET created_at = now() - ($2 || ' hours')::interval WHERE id=$1", [id, String(h)]);
  const exists = async (id: string) => (await admin.query('SELECT 1 FROM users WHERE id=$1', [id])).rowCount === 1;

  it('reserva abandonada (sin verificar, >24 h, sin contenido): se puede reemplazar', async () => {
    const squat = await register(); await ageHours(squat.id, 25);
    const real = await register(squat.email);
    expect(await exists(squat.id)).toBe(false);
    expect(await exists(real.id)).toBe(true);
  });

  it('reserva reciente (<24 h): NO se reemplaza', async () => {
    const squat = await register(); await ageHours(squat.id, 23);
    await expect(register(squat.email)).rejects.toThrow(/email_taken|duplicate|unique/i);
    expect(await exists(squat.id)).toBe(true);
  });

  it('cuenta verificada: NUNCA se reemplaza, aunque sea vieja y esté vacía', async () => {
    const owner = await register(); await verify(await issue(owner)); await ageHours(owner.id, 500);
    await expect(register(owner.email)).rejects.toThrow(/email_taken|duplicate|unique/i);
    expect(await exists(owner.id)).toBe(true);
  });

  it('cuenta con contenido: NO se reemplaza (no se destruyen datos de nadie)', async () => {
    const squat = await register();
    await db.withTenant(squat.id, async tx => {
      const ws = (await tx.query("SELECT id FROM workspaces LIMIT 1")).rows[0].id;
      await tx.query("INSERT INTO sources(workspace_id,owner_id,kind) VALUES ($1,$2,'text')", [ws, squat.id]);
    });
    await ageHours(squat.id, 100);
    await expect(register(squat.email)).rejects.toThrow(/email_taken|duplicate|unique/i);
    expect(await exists(squat.id)).toBe(true);
  });

  it('con workspace compartido NO se reemplaza', async () => {
    const squat = await register(), other = await register();
    const ws = (await admin.query("SELECT id FROM workspaces WHERE created_by=$1", [squat.id])).rows[0].id;
    await admin.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [ws, other.id]);
    await ageHours(squat.id, 100);
    await expect(register(squat.email)).rejects.toThrow(/email_taken|duplicate|unique/i);
    expect(await exists(squat.id)).toBe(true);
  });

  it('el reemplazo es atómico: si el alta falla después, la reserva vieja NO desaparece', async () => {
    const squat = await register(); await ageHours(squat.id, 25);
    const cred = (await admin.query('SELECT credential_id FROM passkeys WHERE user_id=$1', [squat.id])).rows[0].credential_id;
    // el alta falla (credencial repetida de OTRA cuenta): toda la transacción se revierte, incluido el borrado de la reserva
    const other = await register();
    const otherCred = (await admin.query('SELECT credential_id FROM passkeys WHERE user_id=$1', [other.id])).rows[0].credential_id;
    await expect(db.withoutTenant(tx => tx.query('SELECT ms_register_user_with_passkey($1,$2,$3,$4,0,$5,$6,true,$7,$8)',
      [randomUUID(), squat.email, otherCred, randomBytes(77), [], 'multiDevice', 'x', [randomBytes(8).toString('hex')]]))).rejects.toThrow();
    expect(await exists(squat.id)).toBe(true);
    expect(cred).toBeTruthy();
  });
});
