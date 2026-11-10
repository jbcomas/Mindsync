import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createTenantDb } from '@mindsync/db';
import type { RateLimiter } from './ratelimit.js';
import { verificationMail, type Mailer } from './mailer.js';

type Db = ReturnType<typeof createTenantDb>;
export const TOKEN_TTL_HOURS = 24;
const COOLDOWN_MS = 60_000;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface EmailDeps { db: Db; mailer: Mailer; baseUrl: string; limiter: RateLimiter; now?: () => number }

/** Emite un token nuevo (invalida los anteriores sin usar) y envía el correo. Devuelve false si el envío falló. */
export async function issueAndSendVerification(d: EmailDeps, userId: string, email: string): Promise<boolean> {
  const token = randomBytes(32).toString('base64url');
  await d.db.withTenant(userId, async tx => {
    await tx.query('DELETE FROM email_verifications WHERE used_at IS NULL');
    await tx.query(`INSERT INTO email_verifications(user_id, email, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' hours')::interval)`,
      [userId, email, sha256(token), String(TOKEN_TTL_HOURS)]);
  });
  try {
    // El fragmento (#) no se envía al servidor: el token no queda en logs ni en el Referer.
    await d.mailer.send(verificationMail({ to: email, link: `${d.baseUrl.replace(/\/$/, '')}/#verify=${token}`, ttlHours: TOKEN_TTL_HOURS }));
    return true;
  } catch (e) {
    console.error('envío de verificación falló', (e as Error).name);   // sin email ni contenido
    return false;
  }
}

/** Para acciones que exigen identidad verificada (invitar, compartir...). Devuelve true si puede seguir. */
export async function requireVerifiedEmail(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const ok = await db.withTenant(req.userId, async tx => (await tx.query('SELECT ms_email_verified() AS v')).rows[0].v as boolean);
  if (!ok) { reply.code(403).send({ error: 'email_not_verified' }); return false; }
  return true;
}

export function registerEmailRoutes(app: FastifyInstance, d: EmailDeps) {
  // Público: el token prueba el control del buzón, no hace falta sesión (puede abrirse desde el celular).
  // Es un POST (no un GET) para que los antivirus de correo que "hacen clic" en los enlaces no consuman el token.
  app.post('/api/auth/email/verify', async (req, reply) => {
    if (!d.limiter.allow(`ip:${req.ip}`, 40, 10 * 60_000)) return reply.code(429).send({ error: 'too_many_attempts' });
    const b = z.object({ token: z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/) }).safeParse(req.body);
    const bad = () => reply.code(400).send({ error: 'invalid_or_expired' });
    if (!b.success) return bad();
    const uid = await d.db.withoutTenant(async tx => (await tx.query('SELECT ms_verify_email($1) AS u', [sha256(b.data.token)])).rows[0].u as string | null);
    return uid ? { ok: true } : bad();     // misma respuesta para vencido, usado o inexistente
  });

  app.post('/api/auth/email/resend', async (req, reply) => {
    const state = await d.db.withTenant(req.userId, async tx => ({
      u: (await tx.query('SELECT email, email_verified_at IS NOT NULL AS verified FROM users')).rows[0] as { email: string; verified: boolean } | undefined,
      last: ((r: { ms: string | null }) => (r.ms === null ? null : Number(r.ms)))((await tx.query('SELECT extract(epoch FROM (now() - max(created_at))) * 1000 AS ms FROM email_verifications')).rows[0]),
    }));
    if (!state.u) return reply.code(401).send({ error: 'unauthenticated' });
    if (state.u.verified) return reply.code(409).send({ error: 'already_verified' });
    if (state.last !== null && state.last < COOLDOWN_MS) return reply.code(429).send({ error: 'too_soon', retryAfterSeconds: Math.ceil((COOLDOWN_MS - state.last) / 1000) });
    if (!d.limiter.allow(`mail:${req.userId}`, 5, 60 * 60_000)) return reply.code(429).send({ error: 'too_many_attempts' });
    const sent = await issueAndSendVerification(d, req.userId, state.u.email);
    return sent ? { ok: true } : reply.code(502).send({ error: 'mail_failed' });
  });

  // Solo con el mailer de desarrollo (no envía nada): permite verificar sin SMTP. Devuelve únicamente los correos del propio usuario.
  if (d.mailer.kind === 'console') {
    const outbox = (d.mailer as unknown as { outbox: { to: string; subject: string; text: string }[] }).outbox;
    app.get('/api/dev/outbox', async req => {
      const email = await d.db.withTenant(req.userId, async tx => (await tx.query('SELECT email FROM users')).rows[0]?.email as string | undefined);
      return outbox.filter(m => m.to === email).slice(-5).map(m => ({ subject: m.subject, link: m.text.split('\n').find(l => l.startsWith('http')) ?? null }));
    });
  }
}
