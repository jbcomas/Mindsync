import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { createTenantDb } from '@mindsync/db';
import { makeSession, readBlob, signBlob } from './session.js';
import { RateLimiter } from './ratelimit.js';
import { hashCode, newCodeSet } from './recovery.js';

type Db = ReturnType<typeof createTenantDb>;
export interface WebAuthnConfig { rpID: string; rpName: string; origins: string[] }
export interface AuthDeps {
  db: Db; sessionSecret: string; webauthn: WebAuthnConfig; secureCookies?: boolean; limiter?: RateLimiter;
  /** Se invoca tras un alta exitosa (envía el correo de verificación). Nunca debe romper el alta. */
  afterRegister?: (userId: string, email: string) => Promise<void>;
  /** Quién puede crear cuentas. Por defecto abierto (compatibilidad con los tests); el servidor lo fija desde la configuración. */
  registration?: { open: boolean; allowed: string[] };
}

const CHAL = 'ms_chal';
const CHAL_TTL = 5 * 60 * 1000;
const email = z.string().email().max(200).transform(s => s.toLowerCase());
const cred = z.object({
  id: z.string().min(1).max(1024), rawId: z.string().min(1).max(1024), type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()), clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().optional(),
});
const uuidBytes = (id: string) => Uint8Array.from(Buffer.from(id.replace(/-/g, ''), 'hex'));

export function registerAuthRoutes(app: FastifyInstance, d: AuthDeps) {
  const { db, webauthn: wa } = d;
  const limiter = d.limiter ?? new RateLimiter();
  const secure = d.secureCookies ? '; Secure' : '';
  const mayRegister = (email: string) => !d.registration || d.registration.open || d.registration.allowed.includes(email.toLowerCase());

  const setSession = (reply: FastifyReply, userId: string) =>
    reply.header('set-cookie', [
      `ms_session=${makeSession(d.sessionSecret, userId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 3600}${secure}`,
      `${CHAL}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`,
    ]);
  const setChallenge = (reply: FastifyReply, data: Record<string, unknown>) =>
    reply.header('set-cookie', `${CHAL}=${signBlob(d.sessionSecret, data, CHAL_TTL)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${CHAL_TTL / 1000}${secure}`);
  const takeChallenge = (req: FastifyRequest, purpose: string) => {
    const b = readBlob<{ p: string; c: string; e?: string; u?: string }>(d.sessionSecret, req.headers.cookie, CHAL);
    return b && b.p === purpose ? b : null;
  };
  const tooMany = (reply: FastifyReply) => reply.code(429).send({ error: 'too_many_attempts' });
  const ipGuard = (req: FastifyRequest, reply: FastifyReply) => (limiter.allow(`ip:${req.ip}`, 40, 10 * 60_000) ? null : tooMany(reply));

  // ---------------------------------------------------------------- alta de cuenta con el primer passkey
  app.post('/api/auth/register/options', async (req, reply) => {
    if (ipGuard(req, reply)) return;
    const b = z.object({ email }).parse(req.body);
    if (!mayRegister(b.email)) return reply.code(403).send({ error: 'registration_closed' });
    const userId = randomUUID();
    // No se revela si el email ya existe: el rechazo ocurre al verificar (y nunca agrega un passkey a una cuenta existente).
    const options = await generateRegistrationOptions({
      rpName: wa.rpName, rpID: wa.rpID, userName: b.email, userDisplayName: b.email, userID: uuidBytes(userId),
      attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    setChallenge(reply, { p: 'register', c: options.challenge, e: b.email, u: userId });
    return options;
  });

  app.post('/api/auth/register/verify', async (req, reply) => {
    if (ipGuard(req, reply)) return;
    const b = z.object({ response: cred, name: z.string().min(1).max(60).optional() }).parse(req.body);
    const ch = takeChallenge(req, 'register');
    if (!ch?.e || !ch.u) return reply.code(400).send({ error: 'challenge_expired' });
    if (!mayRegister(ch.e)) return reply.code(403).send({ error: 'registration_closed' });   // se revalida: el desafío firmado no autoriza por sí solo
    let info;
    try {
      const v = await verifyRegistrationResponse({
        response: b.response as unknown as RegistrationResponseJSON, expectedChallenge: ch.c,
        expectedOrigin: wa.origins, expectedRPID: wa.rpID, requireUserVerification: true,
      });
      if (!v.verified) return reply.code(400).send({ error: 'registration_failed' });
      info = v.registrationInfo;
    } catch { return reply.code(400).send({ error: 'registration_failed' }); }

    const { codes, hashes } = newCodeSet();
    try {
      await db.withoutTenant(tx => tx.query('SELECT ms_register_user_with_passkey($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        ch.u, ch.e, info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter,
        info.credential.transports ?? [], info.credentialDeviceType, info.credentialBackedUp, b.name ?? 'Passkey', hashes]));
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(400).send({ error: 'registration_failed' }); // email o credencial ya existen
      throw e;
    }
    // El correo de verificación no debe retrasar ni romper el alta (si falla, se puede reenviar).
    await Promise.race([d.afterRegister?.(ch.u, ch.e).catch(() => {}) ?? Promise.resolve(), new Promise(r => setTimeout(r, 4000))]);
    setSession(reply, ch.u);
    // Los códigos se muestran UNA sola vez; en la base solo quedan sus hashes.
    return { ok: true, recoveryCodes: codes };
  });

  // ---------------------------------------------------------------- login (passkey descubrible: sin email)
  app.post('/api/auth/login/options', async (req, reply) => {
    if (ipGuard(req, reply)) return;
    const options = await generateAuthenticationOptions({ rpID: wa.rpID, userVerification: 'required' });
    setChallenge(reply, { p: 'login', c: options.challenge });
    return options;
  });

  app.post('/api/auth/login/verify', async (req, reply) => {
    if (ipGuard(req, reply)) return;
    const b = z.object({ response: cred }).parse(req.body);
    const ch = takeChallenge(req, 'login');
    const fail = () => reply.code(401).send({ error: 'login_failed' });
    if (!ch) return reply.code(400).send({ error: 'challenge_expired' });
    const row = (await db.withoutTenant(async tx => (await tx.query('SELECT * FROM ms_passkey_lookup($1)', [b.response.id])).rows[0])) as
      { user_id: string; public_key: Buffer; counter: string; transports: string[] } | undefined;
    if (!row) return fail();
    let newCounter: number;
    try {
      const v = await verifyAuthenticationResponse({
        response: b.response as unknown as AuthenticationResponseJSON, expectedChallenge: ch.c, expectedOrigin: wa.origins, expectedRPID: wa.rpID,
        credential: { id: b.response.id, publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports as never },
        requireUserVerification: true,
      });
      if (!v.verified) return fail();
      newCounter = v.authenticationInfo.newCounter;
    } catch { return fail(); }
    const ok = await db.withoutTenant(async tx => (await tx.query('SELECT ms_passkey_touch($1,$2) AS ok', [b.response.id, newCounter])).rows[0].ok as boolean);
    if (!ok) return fail();   // contador hacia atrás: posible credencial clonada
    setSession(reply, row.user_id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- recuperación: un código de un solo uso
  app.post('/api/auth/recovery', async (req, reply) => {
    if (ipGuard(req, reply)) return;
    const b = z.object({ email, code: z.string().min(8).max(40) }).parse(req.body);
    if (!limiter.allow(`rec:${b.email}`, 5, 15 * 60_000)) return tooMany(reply);
    const uid = await db.withoutTenant(async tx => (await tx.query('SELECT ms_recovery_login($1,$2) AS u', [b.email, hashCode(b.code)])).rows[0].u as string | null);
    if (!uid) return reply.code(401).send({ error: 'login_failed' });
    setSession(reply, uid);
    return { ok: true, mustAddPasskey: true };
  });

  // ---------------------------------------------------------------- gestión (autenticado)
  app.get('/api/auth/passkeys', async req => db.withTenant(req.userId, async tx => ({
    passkeys: (await tx.query('SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys ORDER BY created_at')).rows,
    recoveryCodesLeft: (await tx.query('SELECT count(*)::int AS n FROM recovery_codes WHERE used_at IS NULL')).rows[0].n,
  })));

  app.post('/api/auth/passkeys/options', async (req, reply) => {
    const { me, existing } = await db.withTenant(req.userId, async tx => ({
      me: (await tx.query('SELECT email FROM users')).rows[0] as { email: string },
      existing: (await tx.query('SELECT credential_id, transports FROM passkeys')).rows as { credential_id: string; transports: string[] }[],
    }));
    const options = await generateRegistrationOptions({
      rpName: wa.rpName, rpID: wa.rpID, userName: me.email, userDisplayName: me.email, userID: uuidBytes(req.userId),
      attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map(c => ({ id: c.credential_id, transports: c.transports })),
    });
    setChallenge(reply, { p: 'add', c: options.challenge, u: req.userId });
    return options;
  });

  app.post('/api/auth/passkeys/verify', async (req, reply) => {
    const b = z.object({ response: cred, name: z.string().min(1).max(60).optional() }).parse(req.body);
    const ch = takeChallenge(req, 'add');
    if (!ch || ch.u !== req.userId) return reply.code(400).send({ error: 'challenge_expired' });
    let info;
    try {
      const v = await verifyRegistrationResponse({
        response: b.response as unknown as RegistrationResponseJSON, expectedChallenge: ch.c,
        expectedOrigin: wa.origins, expectedRPID: wa.rpID, requireUserVerification: true,
      });
      if (!v.verified) return reply.code(400).send({ error: 'registration_failed' });
      info = v.registrationInfo;
    } catch { return reply.code(400).send({ error: 'registration_failed' }); }
    try {
      await db.withTenant(req.userId, tx => tx.query(
        'INSERT INTO passkeys(user_id, credential_id, public_key, counter, transports, device_type, backed_up, name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [req.userId, info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter, info.credential.transports ?? [], info.credentialDeviceType, info.credentialBackedUp, b.name ?? 'Passkey']));
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'already_registered' });
      throw e;
    }
    reply.header('set-cookie', `${CHAL}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`);
    return { ok: true };
  });

  app.patch('/api/auth/passkeys/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
    const n = await db.withTenant(req.userId, async tx => (await tx.query('UPDATE passkeys SET name=$2 WHERE id=$1', [id, b.name])).rowCount);
    return { ok: n === 1 };
  });

  app.delete('/api/auth/passkeys/:id', async (req, reply) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    try {
      const n = await db.withTenant(req.userId, async tx => (await tx.query('DELETE FROM passkeys WHERE id=$1', [id])).rowCount);
      return n ? { ok: true } : reply.code(404).send({ error: 'not_found' });
    } catch (e) {
      if (/last_passkey/.test((e as Error).message)) return reply.code(409).send({ error: 'last_passkey' });
      throw e;
    }
  });

  // ---------------------------------------------------------------- borrar la cuenta (irreversible)
  // Requiere reautenticación con passkey EN ESE MOMENTO (una cookie de sesión robada no alcanza) y escribir el email.
  app.get('/api/account/summary', async req => db.withTenant(req.userId, async tx => {
    const one = async (sql: string) => (await tx.query(sql)).rows[0].n as number;
    return {
      email: (await tx.query('SELECT email FROM users')).rows[0]?.email as string,
      workspaces: await one('SELECT count(*)::int n FROM workspaces'),
      sources: await one('SELECT count(*)::int n FROM sources'),
      entities: await one("SELECT count(*)::int n FROM entities WHERE type NOT IN ('thought','meeting')"),
      passkeys: await one('SELECT count(*)::int n FROM passkeys'),
    };
  }));

  app.post('/api/account/delete/options', async (req, reply) => {
    if (ipGuard(req, reply)) return;
    // Igual que el login: SIN allowCredentials. Si se pide una credencial puntual con sus "transports" (p. ej. hybrid), Chrome
    // ofrece primero el QR del celular en vez de buscar en el almacén donde la passkey realmente vive (observado en pruebas reales).
    // La pertenencia de la passkey a ESTA cuenta se verifica en el servidor al recibir la respuesta (403 si es de otra).
    const options = await generateAuthenticationOptions({ rpID: wa.rpID, userVerification: 'required' });
    setChallenge(reply, { p: 'delete', c: options.challenge, u: req.userId });
    return options;
  });

  app.post('/api/account/delete', async (req, reply) => {
    if (ipGuard(req, reply)) return;
    const b = z.object({ response: cred, confirmEmail: z.string().max(200) }).parse(req.body);
    const ch = takeChallenge(req, 'delete');
    if (!ch || ch.u !== req.userId) return reply.code(400).send({ error: 'challenge_expired' });

    const email = await db.withTenant(req.userId, async tx => (await tx.query('SELECT email FROM users')).rows[0]?.email as string | undefined);
    if (!email) return reply.code(401).send({ error: 'unauthenticated' });
    if (b.confirmEmail.trim().toLowerCase() !== email) return reply.code(400).send({ error: 'confirmation_mismatch' });

    // La passkey usada debe ser de ESTA cuenta (no basta con que sea válida).
    const row = (await db.withoutTenant(async tx => (await tx.query('SELECT * FROM ms_passkey_lookup($1)', [b.response.id])).rows[0])) as
      { user_id: string; public_key: Buffer; counter: string; transports: string[] } | undefined;
    if (!row) return reply.code(401).send({ error: 'login_failed' });
    if (row.user_id !== req.userId) return reply.code(403).send({ error: 'forbidden' });
    let newCounter: number;
    try {
      const v = await verifyAuthenticationResponse({
        response: b.response as unknown as AuthenticationResponseJSON, expectedChallenge: ch.c, expectedOrigin: wa.origins, expectedRPID: wa.rpID,
        credential: { id: b.response.id, publicKey: new Uint8Array(row.public_key), counter: Number(row.counter), transports: row.transports as never },
        requireUserVerification: true,
      });
      if (!v.verified) return reply.code(401).send({ error: 'login_failed' });
      newCounter = v.authenticationInfo.newCounter;
    } catch { return reply.code(401).send({ error: 'login_failed' }); }
    const fresh = await db.withoutTenant(async tx => (await tx.query('SELECT ms_passkey_touch($1,$2) AS ok', [b.response.id, newCounter])).rows[0].ok as boolean);
    if (!fresh) return reply.code(401).send({ error: 'login_failed' });

    try {
      const result = await db.withTenant(req.userId, async tx => (await tx.query('SELECT ms_delete_account() AS r')).rows[0].r);
      reply.header('set-cookie', [
        `ms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
        `${CHAL}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`,
      ]);
      return { ok: true, deleted: result };
    } catch (e) {
      const m = (e as Error).message;
      if (/workspace_shared/.test(m)) return reply.code(409).send({ error: 'workspace_shared' });
      if (/owns_shared_content/.test(m)) return reply.code(409).send({ error: 'owns_shared_content' });
      throw e;
    }
  });

  // Regenerar: invalida todos los anteriores.
  app.post('/api/auth/recovery-codes', async req => {
    const { codes, hashes } = newCodeSet();
    await db.withTenant(req.userId, async tx => {
      await tx.query('DELETE FROM recovery_codes');
      for (const h of hashes) await tx.query('INSERT INTO recovery_codes(user_id, code_hash) VALUES ($1,$2)', [req.userId, h]);
    });
    return { recoveryCodes: codes };
  });
}
