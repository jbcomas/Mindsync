import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantDb, urls } from '@mindsync/db';
import { createGateway, fakeProvider, type LlmProvider } from '@mindsync/llm';
import { buildApp } from '../src/app.js';
import { memoryMailer } from '../src/mailer.js';
import { makeSession, readSession } from '../src/session.js';
import { RateLimiter } from '../src/ratelimit.js';
import { wav } from './audio.test.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret';
const db = createTenantDb(urls.app, { max: 4 });
const route = [{ provider: 'f', model: 'm' }];

const extraction = (text: string) => text.includes('deploy') ? {
  items: [
    { type: 'decision', title: 'Automatizar deploy', epistemic_status: 'claim', quote: 'automatizar el deploy', confidence: 0.9 },
    { type: 'task', title: 'Pedir presupuesto', epistemic_status: 'proposal', quote: 'pedir presupuesto', confidence: 0.8 },
  ], relations: [{ from: 1, to: 0, kind: 'depends_on' }],
} : { items: [], relations: [] };

let transcript = 'Hablante 1: vamos a automatizar el deploy y pedir presupuesto';
const f = fakeProvider(({ messages, system }) => {
  if (system.includes('extractor')) return extraction(messages[0]!.content);
  return { answer: 'Vas a automatizar el deploy [1].', citations: [1], insufficient: false };
}, 'f') as LlmProvider & { calls: number };
(f as any).transcribe = async () => ({ text: transcript, usage: { inputTokens: 1, outputTokens: 1 } });
const gateway = createGateway({
  providers: { f }, routes: { classify: route, extract: route, relate: route, ideate: route, write: route },
  embedding: { provider: 'f', model: 'e', dimensions: 1024 }, transcription: { provider: 'f', model: 't' },
});

let app: Awaited<ReturnType<typeof buildApp>>;
const WA = { rpID: 'localhost', rpName: 'MindSync', origins: ['http://localhost:3000'] };
const email = (s: string) => `${s}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
/** Crea el usuario por la vía real de alta (ms_signup) y firma su cookie de sesión: no hay login sin passkey en la API. */
async function login(e = email('u')) {
  const id = await db.withoutTenant(async tx => (await tx.query('SELECT ms_signup($1) AS id', [e])).rows[0].id as string);
  const cookie = `ms_session=${makeSession(SECRET, id)}`;
  return { cookie, h: { cookie }, id };
}
const json = (r: { body: string }) => JSON.parse(r.body);

beforeAll(async () => { app = await buildApp({ db, gateway, sessionSecret: SECRET, mailer: memoryMailer(), baseUrl: BASE, webauthn: WA, limiter: new RateLimiter() }); });
afterAll(async () => { await app.close(); await db.close(); });

describe('sesión', () => {
  it('firma y verifica; rechaza manipulación y expiración', () => {
    const uid = '11111111-1111-1111-1111-111111111111';
    const c = makeSession(SECRET, uid);
    expect(readSession(SECRET, `ms_session=${c}`)).toBe(uid);
    expect(readSession('otro', `ms_session=${c}`)).toBeNull();
    expect(readSession(SECRET, `ms_session=${c.replace(uid, '22222222-2222-2222-2222-222222222222')}`)).toBeNull();
    expect(readSession(SECRET, `ms_session=${c}`, Date.now() + 40 * 24 * 3600 * 1000)).toBeNull();
    expect(readSession(SECRET, undefined)).toBeNull();
  });
  it('sin cookie todas las rutas de datos dan 401', async () => {
    for (const [m, u] of [['GET', '/api/me'], ['GET', '/api/items'], ['GET', '/api/search?q=x'], ['POST', '/api/chat'], ['POST', '/api/capture'], ['GET', '/api/export']] as const)
      expect((await app.inject({ method: m, url: u })).statusCode, u).toBe(401);
  });
  it('una cookie falsificada da 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'ms_session=11111111-1111-1111-1111-111111111111.9999999999999.firmafalsa' } });
    expect(r.statusCode).toBe(401);
  });
  it('sin resolver de desarrollo, /api/dev-login no existe (404); con resolver funciona', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/dev-login', payload: { email: 'a@b.co' } })).statusCode).toBe(404);
    const withDev = await buildApp({ db, gateway, sessionSecret: SECRET, mailer: memoryMailer(), baseUrl: BASE, webauthn: WA, devLoginResolver: async () => '11111111-1111-1111-1111-111111111111' });
    const r = await withDev.inject({ method: 'POST', url: '/api/dev-login', payload: { email: 'a@b.co' } });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['set-cookie'])).toMatch(/ms_session=/);
    await withDev.close();
  });
});

describe('captura, revisión y lectura', () => {
  it('captura un texto, lista lo extraído con su cita, y el usuario puede confirmar y editar', async () => {
    const { h } = await login();
    const text = `Hay que automatizar el deploy y pedir presupuesto a finanzas ${Math.random()}`;
    const cap = await app.inject({ method: 'POST', url: '/api/capture', headers: h, payload: { text } });
    expect(cap.statusCode).toBe(200);
    expect(json(cap)).toMatchObject({ status: 'done', entities: 2, relations: 1 });

    const items = json(await app.inject({ method: 'GET', url: '/api/items', headers: h }));
    expect(items).toHaveLength(2);
    const dec = items.find((i: any) => i.type === 'decision');
    expect(dec).toMatchObject({ validation_state: 'unreviewed', quote: 'automatizar el deploy', source_kind: 'text' });

    const ok = await app.inject({ method: 'POST', url: `/api/entities/${dec.id}/review`, headers: h, payload: { action: 'confirm' } });
    expect(json(ok)).toEqual({ ok: true, state: 'confirmed' });
    const after = json(await app.inject({ method: 'GET', url: '/api/items?state=confirmed', headers: h }));
    expect(after[0]).toMatchObject({ id: dec.id, epistemic_status: 'decision_confirmed', validation_state: 'confirmed' });

    const task = items.find((i: any) => i.type === 'task');
    await app.inject({ method: 'POST', url: `/api/entities/${task.id}/review`, headers: h, payload: { action: 'edit', title: 'Pedir presupuesto a finanzas (urgente)' } });
    const edited = json(await app.inject({ method: 'GET', url: '/api/items?state=corrected', headers: h }));
    expect(edited[0].title).toBe('Pedir presupuesto a finanzas (urgente)');
  });

  it('valida la entrada', async () => {
    const { h } = await login();
    expect((await app.inject({ method: 'POST', url: '/api/capture', headers: h, payload: { text: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/search', headers: h })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/entities/no-es-uuid/review', headers: h, payload: { action: 'confirm' } })).statusCode).toBe(400);
  });

  it('busca y responde con citas verificables', async () => {
    const { h } = await login();
    await app.inject({ method: 'POST', url: '/api/capture', headers: h, payload: { text: `Quiero automatizar el deploy con agentes ${Math.random()}` } });
    const s = json(await app.inject({ method: 'GET', url: '/api/search?q=deploy', headers: h }));
    expect(s.chunks.length).toBeGreaterThan(0);
    const c = json(await app.inject({ method: 'POST', url: '/api/chat', headers: h, payload: { question: 'qué quiero hacer con el deploy' } }));
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0].text).toContain('deploy');
  });
});

describe('aislamiento entre usuarios en la API', () => {
  it('B no ve, no revisa, no borra ni encuentra nada de A', async () => {
    const A = await login(), B = await login();
    const text = `Secreto de A: hay que automatizar el deploy y pedir presupuesto ${Math.random()}`;
    const cap = json(await app.inject({ method: 'POST', url: '/api/capture', headers: A.h, payload: { text } }));
    const items = json(await app.inject({ method: 'GET', url: '/api/items', headers: A.h }));

    expect(json(await app.inject({ method: 'GET', url: '/api/items', headers: B.h }))).toEqual([]);
    expect(json(await app.inject({ method: 'GET', url: '/api/sources', headers: B.h }))).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/sources/${cap.sourceId}`, headers: B.h })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/entities/${items[0].id}/review`, headers: B.h, payload: { action: 'reject' } })).statusCode).toBe(404);
    expect(json(await app.inject({ method: 'GET', url: '/api/search?q=deploy', headers: B.h })).chunks).toEqual([]);
    const del = await app.inject({ method: 'DELETE', url: `/api/sources/${cap.sourceId}`, headers: B.h });
    expect(json(del).deletedEntities).toBe(0);
    expect(json(await app.inject({ method: 'GET', url: '/api/sources', headers: A.h }))).toHaveLength(1); // sigue ahí
  });

  it('B no puede capturar en el workspace de A', async () => {
    const A = await login(), B = await login();
    const wsA = json(await app.inject({ method: 'GET', url: '/api/me', headers: A.h })).workspaces[0].id;
    const r = await app.inject({ method: 'POST', url: '/api/capture', headers: B.h, payload: { text: 'intruso deploy', workspaceId: wsA } });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toMatch(/row-level|policy|intruso/i); // el error no filtra detalles internos
  });
});

describe('audio y reuniones', () => {
  const wav = Buffer.alloc(4000, 1);
  it('una nota de voz se transcribe y se procesa', async () => {
    const { h } = await login();
    transcript = `Hablante 1: vamos a automatizar el deploy y pedir presupuesto ${Math.random()}`;
    const r = await app.inject({ method: 'POST', url: '/api/capture/audio?kind=voice', headers: { ...h, 'content-type': 'audio/wav' }, payload: wav });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ transcript, status: 'done', entities: 2 });
  });
  it('una reunión sin consentimiento se rechaza ANTES de transcribir', async () => {
    const { h } = await login();
    const before = (f as any).calls;
    const r = await app.inject({ method: 'POST', url: '/api/capture/audio?kind=meeting', headers: { ...h, 'content-type': 'audio/wav' }, payload: wav });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('consent_required');
    expect((f as any).calls).toBe(before);
  });
  it('una reunión con consentimiento declarado se procesa y guarda el registro', async () => {
    const { h } = await login();
    transcript = `Hablante 1: acordamos automatizar el deploy ${Math.random()}\nHablante 2: yo voy a pedir presupuesto`;
    const r = await app.inject({ method: 'POST', url: '/api/capture/audio?kind=meeting&consent=1&selfSpeaker=Hablante%201', headers: { ...h, 'content-type': 'audio/wav' }, payload: wav });
    expect(r.statusCode).toBe(200);
    const src = json(await app.inject({ method: 'GET', url: `/api/sources/${json(r).sourceId}`, headers: h }));
    expect(src.source.kind).toBe('meeting');
  });
  it('audio sin voz => 422; audio vacío => 400', async () => {
    const { h } = await login();
    transcript = '[sin voz]';
    expect((await app.inject({ method: 'POST', url: '/api/capture/audio?kind=voice', headers: { ...h, 'content-type': 'audio/wav' }, payload: wav })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/capture/audio?kind=voice', headers: { ...h, 'content-type': 'audio/wav' }, payload: Buffer.alloc(10) })).statusCode).toBe(400);
  });
});

describe('anti-alucinación de audio', () => {
  const H = (h: object) => ({ ...h, 'content-type': 'audio/wav' });
  it('un WAV en silencio se rechaza SIN llamar al modelo de transcripción', async () => {
    const { h } = await login();
    let called = 0; const orig = (f as any).transcribe;
    (f as any).transcribe = async (...a: unknown[]) => { called++; return orig(...a); };
    const r = await app.inject({ method: 'POST', url: '/api/capture/audio?kind=voice', headers: H(h), payload: wav(30) });
    (f as any).transcribe = orig;
    expect(r.statusCode).toBe(422);
    expect(json(r).error).toBe('no_speech');
    expect(called).toBe(0);
  });
  it('un WAV con señal pasa; ingest=0 devuelve la transcripción para revisar y NO guarda nada', async () => {
    const { h } = await login();
    transcript = 'Hablante 1: texto para revisar antes de guardar';
    const r = await app.inject({ method: 'POST', url: '/api/capture/audio?kind=voice&ingest=0', headers: H(h), payload: wav(5, { hz: 200, amp: 0.2 }) });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ transcript, seconds: 5 });
    expect(json(await app.inject({ method: 'GET', url: '/api/sources', headers: h }))).toEqual([]);
  });
  it('luego el usuario guarda el texto revisado como voz', async () => {
    const { h } = await login();
    const r = await app.inject({ method: 'POST', url: '/api/capture', headers: h, payload: { text: `hay que automatizar el deploy y pedir presupuesto ${Math.random()}`, kind: 'voice', context: { via: 'audio', reviewed: true } } });
    expect(r.statusCode).toBe(200);
    expect(json(await app.inject({ method: 'GET', url: '/api/sources', headers: h }))[0].kind).toBe('voice');
  });
});

describe('control del usuario', () => {
  it('exporta toda la memoria y borra una fuente con sus derivados', async () => {
    const { h } = await login();
    const cap = json(await app.inject({ method: 'POST', url: '/api/capture', headers: h, payload: { text: `automatizar el deploy y pedir presupuesto ${Math.random()}` } }));
    const exp = await app.inject({ method: 'GET', url: '/api/export', headers: h });
    expect(exp.headers['content-disposition']).toMatch(/attachment/);
    const data = json(exp);
    expect(data.format).toBe('mindsync-export-v1');
    expect(data.sources).toHaveLength(1);
    expect(data.entities.length).toBeGreaterThanOrEqual(3); // nota propia + 2 derivados
    expect(data.provenance.some((p: any) => p.quote)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/"vector"/);

    const del = json(await app.inject({ method: 'DELETE', url: `/api/sources/${cap.sourceId}`, headers: h }));
    expect(del.deletedEntities).toBeGreaterThanOrEqual(3);
    expect(json(await app.inject({ method: 'GET', url: '/api/items', headers: h }))).toEqual([]);
    expect(json(await app.inject({ method: 'GET', url: '/api/sources', headers: h }))).toEqual([]);
  });
});

describe('web estática', () => {
  it('sirve la app sin exponer rutas fuera de apps/web', async () => {
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/../api/package.json' })).statusCode).not.toBe(200);
  });
});
