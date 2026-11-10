import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { createTenantDb } from '@mindsync/db';
import { LlmError, type CallRecord, type Gateway } from '@mindsync/llm';
import { ingestText } from '@mindsync/ingest';
import { chatWithMemory, searchMemory } from '@mindsync/memory';
import { makeSession, readSession } from './session.js';
import { analyzeWav } from './audio.js';
import { registerAuthRoutes, type WebAuthnConfig } from './auth.js';
import { RateLimiter } from './ratelimit.js';
import { issueAndSendVerification, registerEmailRoutes } from './email.js';
import type { Mailer } from './mailer.js';

type Db = ReturnType<typeof createTenantDb>;
export interface AppDeps {
  db: Db; gateway: Gateway; sessionSecret: string; webauthn: WebAuthnConfig; secureCookies?: boolean; limiter?: RateLimiter;
  mailer: Mailer; baseUrl: string;
  /** Confiar en X-Forwarded-For (solo si el servidor está detrás de un proxy/túnel y no expuesto directamente). */
  trustProxy?: boolean;
  /** Quién puede crear cuentas nuevas. */
  registration?: { open: boolean; allowed: string[] };
  /** El sitio se sirve por HTTPS: activa HSTS. */
  https?: boolean;
  /** SOLO desarrollo local: si se provee, habilita /api/dev-login (sin passkey). Nunca en producción. */
  devLoginResolver?: (email: string) => Promise<string>;
}

const MAX_AUDIO = 200 * 1024 * 1024; // reuniones largas; el proveedor de transcripción las recibe por Files API si son grandes
const uuid = z.string().uuid();
const here = path.dirname(fileURLToPath(import.meta.url));

declare module 'fastify' { interface FastifyRequest { userId: string } }

export async function buildApp(deps: AppDeps) {
  const { db, gateway } = deps;
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, logger: false, trustProxy: deps.trustProxy ?? false });

  // Cabeceras de seguridad en TODAS las respuestas.
  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', CSP).header('x-content-type-options', 'nosniff').header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer').header('permissions-policy', 'microphone=(self), camera=(), geolocation=(), payment=()')
      .header('cross-origin-opener-policy', 'same-origin').header('cross-origin-resource-policy', 'same-origin');
    if (deps.https) reply.header('strict-transport-security', 'max-age=31536000');
  });

  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: MAX_AUDIO }, (_req, body, done) => done(null, body));

  // Nunca se devuelven mensajes internos (pueden contener contenido del usuario).
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request' });
    if (err instanceof LlmError) return reply.code(err.kind === 'no_provider_allowed' ? 403 : 502).send({ error: `llm_${err.kind}` });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.statusCode === 413 ? 'too_large' : 'bad_request' });
    app.log.error({ code: (err as { code?: string }).code }, 'unhandled');
    return reply.code(500).send({ error: 'internal' });
  });

  // ---- auth
  const publicApi = new Set(['/api/dev-login', '/api/health', '/api/auth/register/options', '/api/auth/register/verify', '/api/auth/login/options', '/api/auth/login/verify', '/api/auth/recovery', '/api/auth/email/verify']);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/api/') || publicApi.has(req.url.split('?')[0]!)) return;
    const uid = readSession(deps.sessionSecret, req.headers.cookie);
    if (!uid) return reply.code(401).send({ error: 'unauthenticated' });
    req.userId = uid;
  });

  const setCookie = (reply: FastifyReply, value: string, maxAge: number) =>
    reply.header('set-cookie', `ms_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${deps.secureCookies ? '; Secure' : ''}`);

  app.get('/api/health', async () => ({ ok: true, devLogin: !!deps.devLoginResolver, mailDev: deps.mailer.kind === 'console' }));

  // Login sin passkey: SOLO desarrollo local (server.ts lo habilita únicamente con DEV_LOGIN=1 y fuera de producción).
  if (deps.devLoginResolver) {
    const resolve = deps.devLoginResolver;
    app.post('/api/dev-login', async (req, reply) => {
      const { email } = z.object({ email: z.string().email().max(200) }).parse(req.body);
      setCookie(reply, makeSession(deps.sessionSecret, await resolve(email)), 30 * 24 * 3600);
      return { ok: true };
    });
  }

  const limiter = deps.limiter ?? new RateLimiter();
  const emailDeps = { db, mailer: deps.mailer, baseUrl: deps.baseUrl, limiter };
  registerAuthRoutes(app, {
    db, sessionSecret: deps.sessionSecret, webauthn: deps.webauthn, secureCookies: deps.secureCookies, limiter,
    registration: deps.registration,
    afterRegister: async (userId, email) => { await issueAndSendVerification(emailDeps, userId, email); },
  });
  registerEmailRoutes(app, emailDeps);

  app.post('/api/logout', async (_req, reply) => { setCookie(reply, '', 0); return { ok: true }; });

  const personalWorkspace = (userId: string) => db.withTenant(userId, async tx =>
    (await tx.query("SELECT id FROM workspaces WHERE kind='personal' ORDER BY created_at LIMIT 1")).rows[0]?.id as string);
  const wsOf = async (req: FastifyRequest, requested?: unknown) => requested ? uuid.parse(requested) : personalWorkspace(req.userId);

  app.get('/api/me', async (req, reply) => {
    const me = await db.withTenant(req.userId, async tx => ({
      user: (await tx.query('SELECT id, email, email_verified_at IS NOT NULL AS "emailVerified" FROM users')).rows[0],
      workspaces: (await tx.query('SELECT id, kind, name FROM workspaces ORDER BY created_at')).rows,
    }));
    // Cookie de una cuenta que ya fue borrada: la sesión es stateless, así que se detecta acá.
    if (!me.user) { setCookie(reply, '', 0); return reply.code(401).send({ error: 'unauthenticated' }); }
    return me;
  });

  // ---- captura
  const collectCalls = () => { const calls: CallRecord[] = []; return { calls, onCall: (r: CallRecord) => { calls.push(r); } }; };

  app.post('/api/capture', async req => {
    const b = z.object({
      text: z.string().min(1).max(400_000), kind: z.enum(['text', 'voice', 'meeting', 'ai_conversation', 'import']).default('text'),
      workspaceId: uuid.optional(), selfSpeaker: z.string().max(80).optional(), consentDeclared: z.boolean().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }).parse(req.body);
    return ingestText({ db, gateway }, { userId: req.userId, workspaceId: await wsOf(req, b.workspaceId), kind: b.kind, text: b.text, selfSpeaker: b.selfSpeaker, consentDeclared: b.consentDeclared, context: b.context });
  });

  app.post('/api/capture/audio', async (req, reply) => {
    const qy = z.object({ kind: z.enum(['voice', 'meeting']).default('voice'), consent: z.enum(['0', '1']).default('0'), selfSpeaker: z.string().max(80).optional(), workspaceId: uuid.optional(),
      /** ingest=0: solo transcribe y devuelve el texto para que el usuario lo revise antes de guardarlo. */
      ingest: z.enum(['0', '1']).default('1') }).parse(req.query);
    if (qy.kind === 'meeting' && qy.consent !== '1') return reply.code(400).send({ error: 'consent_required' });
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length < 1000) return reply.code(400).send({ error: 'empty_audio' });
    const mime = String(req.headers['content-type']).split(';')[0]!.trim();
    // Los modelos inventan transcripciones de silencio/ruido: si el WAV no tiene voz, ni se llama al modelo.
    const check = analyzeWav(audio);
    if (check && !check.hasSpeech) return reply.code(422).send({ error: 'no_speech' });
    const { onCall } = collectCalls();
    const transcript = await gateway.transcribe(audio, mime, 'personal', { onCall });
    if (/^\[sin voz\]$/i.test(transcript.trim())) return reply.code(422).send({ error: 'no_speech' });
    if (qy.ingest === '0') return { transcript, audioBytes: audio.length, seconds: check?.seconds ?? null };
    const result = await ingestText({ db, gateway }, {
      userId: req.userId, workspaceId: await wsOf(req, qy.workspaceId), kind: qy.kind, text: transcript,
      selfSpeaker: qy.selfSpeaker, consentDeclared: qy.consent === '1', context: { via: 'audio', audio_bytes: audio.length },
    });
    return { transcript, ...result };
  });

  // ---- lectura
  app.get('/api/items', async req => {
    const qy = z.object({ state: z.enum(['unreviewed', 'confirmed', 'corrected', 'rejected']).optional(), type: z.string().max(30).optional(), limit: z.coerce.number().int().min(1).max(200).default(60), workspaceId: uuid.optional() }).parse(req.query);
    const ws = await wsOf(req, qy.workspaceId);
    return db.withTenant(req.userId, async tx => (await tx.query(
      `SELECT e.id, e.type, e.title, e.body, e.origin_kind, e.epistemic_status, e.validation_state, e.confidence, e.created_at,
              pr.quote, pr.source_id, who.title AS asserted_by, s.kind AS source_kind, s.captured_at
         FROM entities e
         LEFT JOIN LATERAL (SELECT * FROM provenance p WHERE p.workspace_id = e.workspace_id AND p.entity_id = e.id ORDER BY (p.quote IS NULL) LIMIT 1) pr ON true
         LEFT JOIN entities who ON who.workspace_id = pr.workspace_id AND who.id = pr.asserted_by_entity_id
         LEFT JOIN sources s ON s.workspace_id = pr.workspace_id AND s.id = pr.source_id
        WHERE e.workspace_id = $1 AND e.type NOT IN ('thought','meeting')
          AND ($2::text IS NULL OR e.validation_state = $2) AND ($3::text IS NULL OR e.type = $3)
        ORDER BY e.created_at DESC LIMIT $4`, [ws, qy.state ?? null, qy.type ?? null, qy.limit])).rows);
  });

  app.get('/api/sources', async req => {
    const ws = await wsOf(req, (req.query as Record<string, unknown>).workspaceId);
    return db.withTenant(req.userId, async tx => (await tx.query(
      `SELECT s.id, s.kind, s.captured_at, s.ingestion_status, s.ingestion_error,
              (SELECT left(c.text, 160) FROM chunks c WHERE c.workspace_id = s.workspace_id AND c.source_id = s.id ORDER BY (c.locator->>'start')::int LIMIT 1) AS preview,
              (SELECT count(*)::int FROM provenance p WHERE p.workspace_id = s.workspace_id AND p.source_id = s.id AND p.quote IS NOT NULL) AS derived
         FROM sources s WHERE s.workspace_id = $1 ORDER BY s.captured_at DESC LIMIT 100`, [ws])).rows);
  });

  app.get('/api/sources/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    return db.withTenant(req.userId, async tx => {
      const src = (await tx.query('SELECT id, workspace_id, kind, captured_at, ingestion_status, context FROM sources WHERE id = $1', [id])).rows[0];
      if (!src) return reply.code(404).send({ error: 'not_found' });
      const chunks = (await tx.query("SELECT text FROM chunks WHERE workspace_id=$1 AND source_id=$2 ORDER BY (locator->>'start')::int", [src.workspace_id, id])).rows;
      const items = (await tx.query(
        `SELECT e.id, e.type, e.title, e.validation_state, p.quote FROM provenance p JOIN entities e ON e.workspace_id=p.workspace_id AND e.id=p.entity_id
          WHERE p.workspace_id=$1 AND p.source_id=$2 AND p.quote IS NOT NULL`, [src.workspace_id, id])).rows;
      return { source: src, text: chunks.map((c: { text: string }) => c.text).join('\n'), items };
    });
  });

  app.delete('/api/sources/:id', async req => {
    const id = uuid.parse((req.params as { id: string }).id);
    const ws = await wsOf(req, (req.query as Record<string, unknown>).workspaceId);
    return db.withTenant(req.userId, async tx => {
      const n = (await tx.query('SELECT ms_delete_source($1,$2) AS n', [ws, id])).rows[0].n as number;
      await tx.query("INSERT INTO audit_log(workspace_id, actor_id, actor_kind, action, target_type, target_id) VALUES ($1,$2,'user','source.deleted','source',$3)", [ws, req.userId, id]);
      return { deletedEntities: n };
    });
  });

  // ---- revisión por el usuario
  app.post('/api/entities/:id/review', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ action: z.enum(['confirm', 'reject', 'edit']), title: z.string().min(1).max(200).optional(), body: z.string().max(2000).nullish() }).parse(req.body);
    return db.withTenant(req.userId, async tx => {
      const cur = (await tx.query('SELECT workspace_id, type, title, body, validation_state, epistemic_status FROM entities WHERE id = $1', [id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'not_found' });
      const state = b.action === 'confirm' ? 'confirmed' : b.action === 'reject' ? 'rejected' : 'corrected';
      const title = b.action === 'edit' ? (b.title ?? cur.title) : cur.title;
      const body = b.action === 'edit' ? (b.body === undefined ? cur.body : b.body) : cur.body;
      const epi = b.action !== 'reject' && cur.type === 'decision' ? 'decision_confirmed' : cur.epistemic_status;
      await tx.query(
        `UPDATE entities SET validation_state=$3, epistemic_status=$4, title=$5, body=$6, reviewed_by_kind='user', reviewed_at=now(), updated_at=now()
          WHERE workspace_id=$1 AND id=$2`, [cur.workspace_id, id, state, epi, title, body]);
      const v = (await tx.query('SELECT coalesce(max(version),0)+1 AS v FROM entity_history WHERE workspace_id=$1 AND entity_id=$2', [cur.workspace_id, id])).rows[0].v;
      await tx.query("INSERT INTO entity_history(workspace_id, entity_id, version, diff, changed_by) VALUES ($1,$2,$3,$4,'user')",
        [cur.workspace_id, id, v, JSON.stringify({ action: b.action, before: { title: cur.title, body: cur.body, state: cur.validation_state }, after: { title, body, state } })]);
      return { ok: true, state };
    });
  });

  // ---- búsqueda y chat
  app.get('/api/search', async req => {
    const qy = z.object({ q: z.string().min(1).max(500), workspaceId: uuid.optional() }).parse(req.query);
    return searchMemory({ db, gateway }, { userId: req.userId, workspaceId: await wsOf(req, qy.workspaceId), query: qy.q });
  });

  app.post('/api/chat', async req => {
    const b = z.object({ question: z.string().min(1).max(1000), workspaceId: uuid.optional() }).parse(req.body);
    return chatWithMemory({ db, gateway }, { userId: req.userId, workspaceId: await wsOf(req, b.workspaceId), question: b.question });
  });

  // ---- exportación completa (E6): tu memoria es tuya
  app.get('/api/export', async (req, reply) => {
    const ws = await wsOf(req, (req.query as Record<string, unknown>).workspaceId);
    const data = await db.withTenant(req.userId, async tx => {
      const all = async (sql: string) => (await tx.query(sql, [ws])).rows;
      return {
        exported_at: new Date().toISOString(), format: 'mindsync-export-v1', workspace_id: ws,
        sources: await all('SELECT id, kind, captured_at, context, consent, sha256 FROM sources WHERE workspace_id = $1'),
        chunks: await all('SELECT id, source_id, locator, text FROM chunks WHERE workspace_id = $1'),
        entities: await all('SELECT id, type, title, body, origin_kind, epistemic_status, validation_state, confidence, created_by_kind, created_at, updated_at FROM entities WHERE workspace_id = $1'),
        relations: await all('SELECT id, from_id, to_id, kind, confidence, rationale, validation_state, created_by_kind FROM relations WHERE workspace_id = $1'),
        provenance: await all('SELECT entity_id, source_id, chunk_id, quote, asserted_by_entity_id FROM provenance WHERE workspace_id = $1'),
        entity_history: await all('SELECT entity_id, version, diff, changed_by, at FROM entity_history WHERE workspace_id = $1'),
      };
    });
    return reply.header('content-disposition', 'attachment; filename="mindsync-export.json"').send(data);
  });

  // ---- web estática
  await app.register(fastifyStatic, { root: path.resolve(here, '../../web'), prefix: '/' });
  return app;
}
