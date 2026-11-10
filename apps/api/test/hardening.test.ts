import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenantDb, urls } from '@mindsync/db';
import { createGateway, fakeProvider } from '@mindsync/llm';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { RateLimiter } from '../src/ratelimit.js';
import { memoryMailer } from '../src/mailer.js';
import { SoftAuthenticator } from './authenticator.js';
import { Browser as HelperBrowser } from './helpers.js';

const SECRET = 'h'.repeat(40);
const PUBLIC = { ORIGIN: 'https://mindsync.example.com', SESSION_SECRET: SECRET, ALLOW_DEV_MAIL: '1' };
const cfg = (env: Record<string, string>) => () => loadConfig(env);

describe('loadConfig: negarse a arrancar con configuraciones inseguras', () => {
  it('local por defecto: todo abierto y cómodo', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ origin: 'http://localhost:3000', rpID: 'localhost', isLocal: true, https: false, trustProxy: false, devMail: true });
    expect(c.registration.open).toBe(true);
  });
  it('rechaza el error real del .env: tabulación o espacios dentro de ORIGIN', () => {
    expect(cfg({ ORIGIN: 'https://\tmindsync.comasstudio.com' })).toThrow(/espacios o tabulaciones/);
    expect(cfg({ ORIGIN: 'https:// mindsync.example.com' })).toThrow(/espacios o tabulaciones/);
    expect(cfg({ ORIGIN: 'https://mindsync.example.com', RP_ID: 'mindsync.example.com\t' })).toThrow(/RP_ID/);
  });
  it('ORIGIN: solo esquema + dominio, y http(s)', () => {
    expect(cfg({ ORIGIN: 'https://x.example.com/app' })).toThrow(/sin ruta/);
    expect(cfg({ ORIGIN: 'https://x.example.com?a=1' })).toThrow(/sin ruta/);
    expect(cfg({ ORIGIN: 'ftp://x.example.com' })).toThrow(/http/);
    expect(cfg({ ORIGIN: 'no es una url' })).toThrow();
    expect(loadConfig({ ...PUBLIC, ORIGIN: 'https://x.example.com/', ALLOWED_EMAILS: 'a@b.co' }).origin).toBe('https://x.example.com');
  });
  it('RP_ID debe ser el dominio del origen o uno padre (si no, el navegador rechaza las passkeys)', () => {
    expect(cfg({ ...PUBLIC, RP_ID: 'otro.com' })).toThrow(/RP_ID/);
    expect(loadConfig({ ...PUBLIC, RP_ID: 'example.com' }).rpID).toBe('example.com');
    expect(loadConfig({ ...PUBLIC }).rpID).toBe('mindsync.example.com');
    expect(cfg({ ...PUBLIC, RP_ID: 'ample.com' })).toThrow(/RP_ID/);        // sufijo textual que NO es dominio padre
  });
  it('un dominio público exige https, SESSION_SECRET real y no acepta el secreto de desarrollo', () => {
    expect(cfg({ ...PUBLIC, ORIGIN: 'http://mindsync.example.com' })).toThrow(/https/);
    expect(cfg({ ORIGIN: PUBLIC.ORIGIN, ALLOW_DEV_MAIL: '1' })).toThrow(/SESSION_SECRET/);
    expect(cfg({ ...PUBLIC, SESSION_SECRET: 'dev-only-secret-change-me' })).toThrow(/SESSION_SECRET/);
    expect(cfg({ ...PUBLIC, SESSION_SECRET: 'corto' })).toThrow(/32 caracteres/);
  });
  it('DEV_LOGIN (entrar sin passkey) jamás en un dominio público ni en producción', () => {
    expect(cfg({ ...PUBLIC, DEV_LOGIN: '1' })).toThrow(/DEV_LOGIN/);
    expect(cfg({ NODE_ENV: 'production', DEV_LOGIN: '1', SESSION_SECRET: SECRET })).toThrow(/DEV_LOGIN/);
    expect(loadConfig({ DEV_LOGIN: '1' }).devLogin).toBe(true);           // local: sí
  });
  it('sin SMTP en un dominio público: la bandeja de desarrollo invalida la verificación, hay que aceptarlo expresamente', () => {
    expect(cfg({ ORIGIN: PUBLIC.ORIGIN, SESSION_SECRET: SECRET })).toThrow(/cualquiera podría/);
    expect(loadConfig({ ...PUBLIC }).warnings.join()).toMatch(/no prueba nada/);
    expect(cfg({ NODE_ENV: 'production', ORIGIN: PUBLIC.ORIGIN, SESSION_SECRET: SECRET, ALLOW_DEV_MAIL: '1' })).toThrow(/obligatorios en producción/);
    expect(cfg({ ...PUBLIC, SMTP_URL: 'smtps://u:p@h:465' })).toThrow(/MAIL_FROM/);
    expect(loadConfig({ ORIGIN: PUBLIC.ORIGIN, SESSION_SECRET: SECRET, SMTP_URL: 'smtps://u:p@h:465', MAIL_FROM: 'a@b.co' }).devMail).toBe(false);
  });
  it('registro: cerrado por defecto en un dominio público (cada cuenta puede gastar tus claves de IA)', () => {
    const c = loadConfig({ ...PUBLIC, ALLOWED_EMAILS: ' Ana@Example.com , luis@example.com ' });
    expect(c.registration).toEqual({ open: false, allowed: ['ana@example.com', 'luis@example.com'] });
    expect(cfg({ ...PUBLIC, REGISTRATION: 'open' })).toThrow(/gaste tus claves/);
    expect(loadConfig({ ...PUBLIC, REGISTRATION: 'open', ALLOW_OPEN_REGISTRATION: '1' }).registration.open).toBe(true);
    expect(cfg({ ...PUBLIC, ALLOWED_EMAILS: 'no-es-email' })).toThrow(/inválido/);
    expect(loadConfig({ ...PUBLIC }).warnings.join()).toMatch(/nadie nuevo/);
  });
  it('proxy: se confía en X-Forwarded-For solo detrás de un proxy local (puerto no expuesto)', () => {
    expect(loadConfig({ ...PUBLIC }).trustProxy).toBe(true);
    expect(loadConfig({ ...PUBLIC, HOST: '0.0.0.0' }).trustProxy).toBe(false);
    expect(loadConfig({ ...PUBLIC, HOST: '0.0.0.0', TRUST_PROXY: '1' }).warnings.join()).toMatch(/falsificar/);
    expect(loadConfig({}).trustProxy).toBe(false);
  });
});

// ------------------------------------------------------------------ comportamiento de la app
const db = createTenantDb(urls.app, { max: 3 });
const f = fakeProvider(() => ({ items: [], relations: [] }), 'f'); const route = [{ provider: 'f', model: 'm' }];
const gateway = createGateway({ providers: { f }, routes: { classify: route, extract: route, relate: route, ideate: route, write: route }, embedding: { provider: 'f', model: 'e', dimensions: 1024 } });
const WA = { rpID: 'localhost', rpName: 'MindSync', origins: ['http://localhost:3000'] };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const mk = async (over: object = {}) => { const a = await buildApp({ db, gateway, sessionSecret: SECRET, webauthn: WA, mailer: memoryMailer(), baseUrl: 'http://localhost:3000', limiter: new RateLimiter(), ...over } as never); apps.push(a); return a; };
afterAll(async () => { for (const a of apps) await a.close(); await db.close(); });
const em = (p = 'g') => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;

describe('puerta de registro', () => {
  it('cerrada: solo los emails invitados pueden crear cuenta (sin distinguir mayúsculas); el resto recibe 403', async () => {
    const guest = em('inv'), stranger = em('ext');
    const app = await mk({ registration: { open: false, allowed: [guest] } });
    const B = () => new HelperBrowser(() => app);
    const ok = await B().register(new SoftAuthenticator(), guest.toUpperCase());
    expect(ok.ver.status).toBe(200);
    const no = await B().register(new SoftAuthenticator(), stranger);
    expect(no.opt.status).toBe(403); expect(no.opt.body.error).toBe('registration_closed');
    expect(no.ver.status).toBe(400);                       // sin desafío, ni siquiera llega a verificar
  });
  it('el desafío firmado no autoriza por sí solo: la lista se vuelve a comprobar al verificar', async () => {
    const guest = em('inv');
    const open = await mk({ registration: { open: true, allowed: [] } });
    const b = new HelperBrowser(() => open); const a = new SoftAuthenticator();
    const opt = await b.call('POST', '/api/auth/register/options', { email: em('ext') });   // con el registro abierto obtiene un desafío válido...
    expect(opt.status).toBe(200);
    // ...pero se lo presenta a una instancia con el registro cerrado (mismo secreto): debe rechazarlo
    const closed = await mk({ registration: { open: false, allowed: [guest] } });
    const b2 = new HelperBrowser(() => closed); b2.jar = new Map(b.jar); b2.paths = new Map(b.paths);
    const r = await b2.call('POST', '/api/auth/register/verify', { response: a.register(opt.body.challenge) });
    expect(r.status).toBe(403); expect(r.body.error).toBe('registration_closed');
  });
  it('las cuentas existentes siguen entrando aunque el registro esté cerrado', async () => {
    const open = await mk(); const e = em('old'); const a = new SoftAuthenticator();
    await new HelperBrowser(() => open).register(a, e);
    const closed = await mk({ registration: { open: false, allowed: [] } });
    expect((await new HelperBrowser(() => closed).login(a)).status).toBe(200);
  });
});

describe('cabeceras de seguridad', () => {
  it('todas las respuestas llevan CSP estricta, nosniff, anti-frames y no filtran el Referer', async () => {
    const app = await mk();
    for (const url of ['/', '/app.js', '/api/health', '/api/me']) {
      const h = (await app.inject({ method: 'GET', url })).headers;
      expect(h['content-security-policy'], url).toMatch(/default-src 'self'/);
      expect(h['content-security-policy']).toMatch(/frame-ancestors 'none'/);
      const scriptSrc = String(h['content-security-policy']).split(';').map(x => x.trim()).find(x => x.startsWith('script-src'));
      expect(scriptSrc).toBe("script-src 'self'");     // scripts: solo los del propio sitio, sin 'unsafe-inline' ni 'unsafe-eval' (los estilos en línea sí, la app los usa)
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['permissions-policy']).toMatch(/microphone=\(self\)/);
    }
  });
  it('HSTS solo cuando se sirve por HTTPS', async () => {
    expect((await (await mk()).inject({ method: 'GET', url: '/api/health' })).headers['strict-transport-security']).toBeUndefined();
    expect((await (await mk({ https: true })).inject({ method: 'GET', url: '/api/health' })).headers['strict-transport-security']).toMatch(/max-age=31536000/);
  });
  it('la cookie de sesión lleva Secure cuando el sitio es https', async () => {
    const app = await mk({ secureCookies: true });
    const b = new HelperBrowser(() => app);
    const r = await b.register(new SoftAuthenticator(), em('sec'));
    expect(String(r.ver.raw.headers['set-cookie'])).toMatch(/ms_session=[^;]+;.*Secure/);
  });
});

describe('detrás de un proxy/túnel', () => {
  const hit = (app: Awaited<ReturnType<typeof buildApp>>, xff?: string) => app.inject({ method: 'POST', url: '/api/auth/login/options', remoteAddress: '127.0.0.1', headers: xff ? { 'x-forwarded-for': xff } : {} });
  it('con trustProxy cada cliente real tiene su propio límite de intentos', async () => {
    const app = await mk({ trustProxy: true });
    for (let i = 0; i < 45; i++) await hit(app, '203.0.113.7');              // un cliente abusa...
    expect((await hit(app, '203.0.113.7')).statusCode).toBe(429);
    expect((await hit(app, '198.51.100.9')).statusCode).toBe(200);           // ...y otro cliente distinto NO queda bloqueado
  });
  it('sin trustProxy, X-Forwarded-For se IGNORA (no se puede falsificar la IP para saltear el límite)', async () => {
    const app = await mk({ trustProxy: false });
    for (let i = 0; i < 45; i++) await hit(app, `203.0.113.${i}`);           // cada pedido finge una IP distinta
    expect((await hit(app, '198.51.100.9')).statusCode).toBe(429);
  });
});
