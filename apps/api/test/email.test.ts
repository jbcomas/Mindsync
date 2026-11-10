import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import nodemailer from 'nodemailer';
import { createTenantDb, urls } from '@mindsync/db';
import { createGateway, fakeProvider } from '@mindsync/llm';
import { buildApp } from '../src/app.js';
import { RateLimiter } from '../src/ratelimit.js';
import { consoleMailer, escapeHtml, memoryMailer, smtpMailer, verificationMail } from '../src/mailer.js';
import { sha256 } from '../src/email.js';
import { SoftAuthenticator } from './authenticator.js';
import { Browser as HelperBrowser } from './helpers.js';

const SECRET = 'email-test-secret', BASE = 'https://app.mindsync.test';
const WA = { rpID: 'localhost', rpName: 'MindSync', origins: ['http://localhost:3000'] };
const db = createTenantDb(urls.app, { max: 4 });
const admin = new pg.Pool({ connectionString: urls.admin });
const f = fakeProvider(() => ({ items: [], relations: [] }), 'f'); const route = [{ provider: 'f', model: 'm' }];
const gateway = createGateway({ providers: { f }, routes: { classify: route, extract: route, relate: route, ideate: route, write: route }, embedding: { provider: 'f', model: 'e', dimensions: 1024 } });

const mailer = memoryMailer(); const limiter = new RateLimiter();
let app: Awaited<ReturnType<typeof buildApp>>;
const mk = (over: object = {}) => buildApp({ db, gateway, sessionSecret: SECRET, webauthn: WA, mailer, baseUrl: BASE, limiter, ...over } as never);
beforeAll(async () => { app = await mk(); });
afterAll(async () => { await app.close(); await db.close(); await admin.end(); });
beforeEach(() => { limiter.reset(); mailer.sent.length = 0; mailer.failNext = false; });

const B = class extends HelperBrowser { constructor(a = () => app) { super(a); } };
type B = InstanceType<typeof B>;
const tokenFrom = (m: { text: string }) => /#verify=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
const lastMail = (to: string) => [...mailer.sent].reverse().find(m => m.to === to)!;
const ageTokens = (email: string, secs: number) => admin.query(`UPDATE email_verifications SET created_at = now() - ($2 || ' seconds')::interval FROM users u WHERE u.id = user_id AND u.email = $1`, [email, String(secs)]);
async function signup() { const b = new B(); const r = await b.register(new SoftAuthenticator()); return { b, ...r }; }
const verifyToken = (token: string, b = new B()) => b.call('POST', '/api/auth/email/verify', { token });

describe('correo de verificación al registrarse', () => {
  it('envía UN correo a ese email, con el enlace al dominio de la app y el token en el fragmento (#)', async () => {
    const { email } = await signup();
    expect(mailer.sent).toHaveLength(1);
    const m = mailer.sent[0]!;
    expect(m.to).toBe(email);
    expect(m.subject).toMatch(/Confirmá tu email/);
    const link = m.text.split('\n').find(l => l.startsWith('http'))!;
    expect(link.startsWith(`${BASE}/#verify=`)).toBe(true);
    expect(link).not.toContain('?');                         // nada en la query: el token no viaja al servidor
    expect(tokenFrom(m)).toHaveLength(43);                   // 256 bits en base64url
  });

  it('la cuenta nace sin verificar', async () => {
    const { b } = await signup();
    expect((await b.call('GET', '/api/me')).body.user.emailVerified).toBe(false);
  });

  it('si el correo falla, el alta NO falla y se puede reenviar después', async () => {
    mailer.failNext = true;
    const { b, email } = await signup();
    expect((await b.call('GET', '/api/me')).status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
    await ageTokens(email, 120);
    expect((await b.call('POST', '/api/auth/email/resend')).status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });

  it('registrar un email que ya existe no envía correo a esa dirección ni revela que existe', async () => {
    const { email } = await signup(); const before = mailer.sent.length;
    const { ver } = await new B().register(new SoftAuthenticator(), email);
    expect(ver.status).toBe(400); expect(ver.body.error).toBe('registration_failed');
    expect(mailer.sent.length).toBe(before);
  });
});

describe('confirmar el email', () => {
  it('el token verifica la cuenta; se puede abrir desde OTRO navegador sin sesión', async () => {
    const { b, email } = await signup();
    const r = await verifyToken(tokenFrom(lastMail(email)));      // navegador nuevo, sin cookies (p. ej. el celular)
    expect(r.status).toBe(200);
    expect((await b.call('GET', '/api/me')).body.user.emailVerified).toBe(true);
    expect(r.raw.headers['set-cookie']).toBeUndefined();          // verificar NO inicia sesión
  });

  it('es de un solo uso; inexistente, mal formado o vencido dan EXACTAMENTE la misma respuesta', async () => {
    const { email } = await signup(); const t = tokenFrom(lastMail(email));
    expect((await verifyToken(t)).status).toBe(200);
    const used = await verifyToken(t);
    const unknown = await verifyToken('A'.repeat(43));
    const malformed = await verifyToken('corto');
    const symbols = await verifyToken("'; DROP TABLE users;--" + 'x'.repeat(30));
    for (const r of [used, unknown, malformed, symbols]) { expect(r.status).toBe(400); expect(r.body).toEqual({ error: 'invalid_or_expired' }); }
    const { email: e2 } = await signup(); const t2 = tokenFrom(lastMail(e2));
    await admin.query("UPDATE email_verifications SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [sha256(t2)]);
    const expired = await verifyToken(t2);
    expect(expired.status).toBe(400); expect(expired.body).toEqual({ error: 'invalid_or_expired' });
  });

  it('el token de una cuenta no verifica a otra', async () => {
    const A = await signup(), Bb = await signup();
    await verifyToken(tokenFrom(lastMail(A.email)));
    expect((await Bb.b.call('GET', '/api/me')).body.user.emailVerified).toBe(false);
  });

  it('en la base solo queda el hash del token', async () => {
    const { email } = await signup(); const t = tokenFrom(lastMail(email));
    const rows = (await admin.query('SELECT token_hash FROM email_verifications v JOIN users u ON u.id=v.user_id WHERE u.email=$1', [email])).rows;
    expect(rows[0].token_hash).toBe(sha256(t)); expect(JSON.stringify(rows)).not.toContain(t);
  });

  it('limita los intentos por IP (no se puede adivinar tokens)', async () => {
    const lim = await mk({ limiter: new RateLimiter() });
    let last = 0;
    for (let i = 0; i < 45; i++) last = (await lim.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: 'A'.repeat(43) } })).statusCode;
    expect(last).toBe(429);
    await lim.close();
  });
});

describe('reenviar', () => {
  it('exige sesión', async () => { expect((await new B().call('POST', '/api/auth/email/resend')).status).toBe(401); });

  it('respeta una espera de 60 s entre envíos', async () => {
    const { b } = await signup();
    const r = await b.call('POST', '/api/auth/email/resend');
    expect(r.status).toBe(429); expect(r.body.error).toBe('too_soon'); expect(r.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it('el reenvío invalida el token anterior y el nuevo funciona', async () => {
    const { b, email } = await signup(); const old = tokenFrom(lastMail(email));
    await ageTokens(email, 120);
    expect((await b.call('POST', '/api/auth/email/resend')).status).toBe(200);
    const fresh = tokenFrom(lastMail(email));
    expect(fresh).not.toBe(old);
    expect((await verifyToken(old)).status).toBe(400);
    expect((await verifyToken(fresh)).status).toBe(200);
  });

  it('con el email ya verificado responde 409 y no envía nada', async () => {
    const { b, email } = await signup(); await verifyToken(tokenFrom(lastMail(email)));
    const n = mailer.sent.length; await ageTokens(email, 120);
    const r = await b.call('POST', '/api/auth/email/resend');
    expect(r.status).toBe(409); expect(r.body.error).toBe('already_verified'); expect(mailer.sent.length).toBe(n);
  });

  it('tope de 5 reenvíos por hora', async () => {
    const { b, email } = await signup();
    for (let i = 0; i < 5; i++) { await ageTokens(email, 120); expect((await b.call('POST', '/api/auth/email/resend')).status, `envío ${i + 1}`).toBe(200); }
    await ageTokens(email, 120);
    const r = await b.call('POST', '/api/auth/email/resend');
    expect(r.status).toBe(429); expect(r.body.error).toBe('too_many_attempts');
  });

  it('un usuario no puede forzar correos a la dirección de otro', async () => {
    const A = await signup(), Bb = await signup(); const nA = mailer.sent.filter(m => m.to === A.email).length;
    await ageTokens(Bb.email, 120); await Bb.b.call('POST', '/api/auth/email/resend');
    expect(mailer.sent.filter(m => m.to === A.email).length).toBe(nA);
  });
});

describe('cuentas fantasma (reserva del email de otra persona)', () => {
  it('una reserva abandonada se puede reemplazar; la persona real registra su email y recibe SU correo', async () => {
    const squat = await signup();
    await admin.query("UPDATE users SET created_at = now() - interval '30 hours' WHERE email = $1", [squat.email]);
    const real = new B(); const a = new SoftAuthenticator();
    const { ver } = await real.register(a, squat.email);
    expect(ver.status).toBe(200);
    expect((await real.call('GET', '/api/me')).body.user.email).toBe(squat.email);
    expect((await new B().login(new SoftAuthenticator())).status).toBe(401);
    expect(mailer.sent.filter(m => m.to === squat.email).length).toBe(2);   // el del squatter y el de la persona real
  });

  it('una cuenta verificada nunca se reemplaza', async () => {
    const owner = await signup(); await verifyToken(tokenFrom(lastMail(owner.email)));
    await admin.query("UPDATE users SET created_at = now() - interval '900 hours' WHERE email = $1", [owner.email]);
    const { ver } = await new B().register(new SoftAuthenticator(), owner.email);
    expect(ver.status).toBe(400);
    expect((await owner.b.call('GET', '/api/me')).status).toBe(200);
  });
});

describe('bandeja de desarrollo', () => {
  it('con el mailer de consola devuelve SOLO los correos del propio usuario y no envía nada real', async () => {
    const con = consoleMailer(() => {}); const dev = await mk({ mailer: con });
    const get = () => new B(() => dev);
    const A = get(), Bb = get();
    const ra = await A.register(new SoftAuthenticator()), rb = await Bb.register(new SoftAuthenticator());
    const mine = (await A.call('GET', '/api/dev/outbox')).body as { subject: string; link: string }[];
    expect(mine).toHaveLength(1); expect(mine[0]!.link.startsWith(`${BASE}/#verify=`)).toBe(true);
    expect(con.outbox.map(m => m.to).sort()).toEqual([ra.email, rb.email].sort());
    expect(JSON.stringify((await Bb.call('GET', '/api/dev/outbox')).body)).not.toContain(mine[0]!.link);
    expect((await new B(() => dev).call('GET', '/api/dev/outbox')).status).toBe(401);
    await dev.close();
  });
  it('con SMTP real (o cualquier otro mailer) la ruta ni existe', async () => {
    const { b } = await signup();                      // autenticado, para que el 401 del filtro no tape la prueba
    expect((await b.call('GET', '/api/dev/outbox')).status).toBe(404);
  });
});

describe('mailer', () => {
  it('SMTP: arma el mensaje con remitente, destinatario único, asunto fijo y cuerpo texto + HTML', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const m = verificationMail({ to: 'ana@example.com', link: 'https://x.test/#verify=abc', ttlHours: 24 });
    let sent: any; const orig = transport.sendMail.bind(transport);
    (transport as any).sendMail = async (o: any) => { sent = await orig(o); return sent; };
    await smtpMailer({ from: 'MindSync <no-reply@x.test>', transport }).send(m);
    const msg = JSON.parse(sent.message);
    expect(msg.to).toEqual([{ address: 'ana@example.com', name: '' }]);
    expect(msg.from.address).toBe('no-reply@x.test');
    expect(msg.subject).toBe('Confirmá tu email en MindSync');
    expect(msg.text).toContain('https://x.test/#verify=abc');
    expect(msg.html).toContain('href="https://x.test/#verify=abc"');
  });
  it('escapa HTML', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
    const m = verificationMail({ to: 'a@b.co', link: 'https://x.test/#verify="><script>alert(1)</script>', ttlHours: 24 });
    expect(m.html).not.toContain('<script>');
  });
});
