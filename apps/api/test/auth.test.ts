import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createTenantDb, urls } from '@mindsync/db';
import { createGateway, fakeProvider } from '@mindsync/llm';
import { buildApp } from '../src/app.js';
import { RateLimiter } from '../src/ratelimit.js';
import { SoftAuthenticator } from './authenticator.js';
import { Browser as HelperBrowser } from './helpers.js';
import { memoryMailer } from '../src/mailer.js';

const SECRET = 'auth-test-secret';
const BASE = 'http://localhost:3000';
const WA = { rpID: 'localhost', rpName: 'MindSync', origins: ['http://localhost:3000'] };
const db = createTenantDb(urls.app, { max: 4 });
const admin = new pg.Pool({ connectionString: urls.admin });
const f = fakeProvider(() => ({ items: [], relations: [] }), 'f');
const route = [{ provider: 'f', model: 'm' }];
const gateway = createGateway({ providers: { f }, routes: { classify: route, extract: route, relate: route, ideate: route, write: route }, embedding: { provider: 'f', model: 'e', dimensions: 1024 } });

let app: Awaited<ReturnType<typeof buildApp>>;
const limiter = new RateLimiter();
beforeAll(async () => { app = await buildApp({ db, gateway, sessionSecret: SECRET, mailer: memoryMailer(), baseUrl: BASE, webauthn: WA, limiter }); });
beforeEach(() => limiter.reset());   // todos los tests comparten IP; cada uno parte con el contador en cero
afterAll(async () => { await app.close(); await db.close(); await admin.end(); });

const Browser = class extends HelperBrowser { constructor() { super(() => app); } };
type Browser = InstanceType<typeof Browser>;

describe('registro con passkey', () => {
  it('crea la cuenta, devuelve 8 códigos de recuperación, deja la sesión iniciada y un workspace personal', async () => {
    const b = new Browser(), auth = new SoftAuthenticator();
    const { email, opt, ver } = await b.register(auth);
    expect(opt.body.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(opt.body.rp).toMatchObject({ id: 'localhost' });
    expect(ver.status).toBe(200);
    expect(ver.body.recoveryCodes).toHaveLength(8);
    expect(ver.body.recoveryCodes[0]).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    const me = await b.call('GET', '/api/me');
    expect(me.body.user.email).toBe(email);
    expect(me.body.workspaces[0].kind).toBe('personal');
  });

  it('los códigos NO se guardan en claro', async () => {
    const b = new Browser(); const { email, ver } = await b.register(new SoftAuthenticator());
    const rows = (await admin.query('SELECT code_hash FROM recovery_codes rc JOIN users u ON u.id = rc.user_id WHERE u.email = $1', [email])).rows.map(r => r.code_hash);
    expect(rows).toHaveLength(8);
    for (const c of ver.body.recoveryCodes) { expect(rows).not.toContain(c); expect(rows).not.toContain(c.replace(/-/g, '')); }
  });

  it('un email ya registrado NO permite agregarse un passkey (toma de cuenta): falla genérico y la cuenta queda intacta', async () => {
    const owner = new Browser(), attacker = new Browser();
    const { email } = await owner.register(new SoftAuthenticator());
    const evil = new SoftAuthenticator();
    const { ver } = await attacker.register(evil, email);
    expect(ver.status).toBe(400);
    expect(ver.body.error).toBe('registration_failed');
    expect(attacker.jar.has('ms_session')).toBe(false);
    expect((await attacker.login(evil)).status).toBe(401);            // el passkey del atacante no existe
    expect((await owner.call('GET', '/api/auth/passkeys')).body.passkeys).toHaveLength(1);
  });

  it('rechaza origen falso, RP ID falso y falta de verificación de usuario', async () => {
    for (const bad of [{ origin: 'https://evil.example' }, { rpID: 'evil.example' }, { flags: { uv: false } }]) {
      const b = new Browser(), a = new SoftAuthenticator();
      const opt = await b.call('POST', '/api/auth/register/options', { email: `bad-${Math.random().toString(36).slice(2)}@test.local` });
      const ver = await b.call('POST', '/api/auth/register/verify', { response: a.register(opt.body.challenge, bad) });
      expect(ver.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('el challenge es obligatorio y de un solo propósito', async () => {
    const b = new Browser(), a = new SoftAuthenticator();
    expect((await b.call('POST', '/api/auth/register/verify', { response: a.register('x') })).status).toBe(400);   // sin challenge
    const login = await b.call('POST', '/api/auth/login/options');
    const r = await b.call('POST', '/api/auth/register/verify', { response: a.register(login.body.challenge) });      // challenge de login usado para registrar
    expect(r.status).toBe(400);
  });

  it('un challenge adulterado se rechaza', async () => {
    const b = new Browser(), a = new SoftAuthenticator();
    await b.call('POST', '/api/auth/register/options', { email: 'tamper@test.local' });
    const c = b.jar.get('ms_chal')!; b.jar.set('ms_chal', c.slice(0, -3) + 'AAA');
    expect((await b.call('POST', '/api/auth/register/verify', { response: a.register('lo-que-sea') })).status).toBe(400);
  });
});

describe('login con passkey descubrible', () => {
  it('inicia sesión sin email ni contraseña y entra a SU cuenta', async () => {
    const a = new SoftAuthenticator(), reg = new Browser();
    const { email } = await reg.register(a);
    const b = new Browser();
    const r = await b.login(a);
    expect(r.status).toBe(200);
    expect((await b.call('GET', '/api/me')).body.user.email).toBe(email);
  });

  it('un passkey desconocido, una firma corrupta o de otra clave NO inician sesión', async () => {
    const a = new SoftAuthenticator(); await new Browser().register(a);
    expect((await new Browser().login(new SoftAuthenticator())).status).toBe(401);                       // credencial que no existe
    expect((await new Browser().login(a, { corruptSignature: true })).status).toBe(401);
    expect((await new Browser().login(a, { signWith: SoftAuthenticator.otherKey() })).status).toBe(401); // firmada con otra clave
    const ok = new Browser(); expect((await ok.login(a)).status).toBe(200);
  });

  it('rechaza origen falso, RP ID falso y sin verificación de usuario', async () => {
    const a = new SoftAuthenticator(); await new Browser().register(a);
    for (const bad of [{ origin: 'https://evil.example' }, { rpID: 'evil.example' }, { flags: { uv: false } }])
      expect((await new Browser().login(a, bad)).status, JSON.stringify(bad)).toBe(401);
  });

  it('no se puede reutilizar una respuesta vieja con un challenge nuevo (anti-replay)', async () => {
    const a = new SoftAuthenticator(); await new Browser().register(a);
    const b = new Browser();
    const o1 = await b.call('POST', '/api/auth/login/options');
    const stolen = a.assert(o1.body.challenge);
    expect((await b.call('POST', '/api/auth/login/verify', { response: stolen })).status).toBe(200);
    const attacker = new Browser();
    await attacker.call('POST', '/api/auth/login/options');            // challenge distinto
    expect((await attacker.call('POST', '/api/auth/login/verify', { response: stolen })).status).toBe(401);
    expect((await new Browser().call('POST', '/api/auth/login/verify', { response: stolen })).status).toBe(400); // ni siquiera hay challenge
  });

  it('el contador anti-clonado: un contador que retrocede se rechaza', async () => {
    const a = new SoftAuthenticator(); await new Browser().register(a);
    expect((await new Browser().login(a, { counter: 5 })).status).toBe(200);
    expect((await new Browser().login(a, { counter: 6 })).status).toBe(200);
    expect((await new Browser().login(a, { counter: 3 })).status).toBe(401);   // credencial clonada
    expect((await new Browser().login(a, { counter: 6 })).status).toBe(401);   // repetido
    expect((await new Browser().login(a, { counter: 7 })).status).toBe(200);
  });

  it('un passkey de A no puede iniciar sesión como B', async () => {
    const aa = new SoftAuthenticator(), bb = new SoftAuthenticator();
    const A = new Browser(), B = new Browser();
    const ra = await A.register(aa), rb = await B.register(bb);
    const s = new Browser(); await s.login(aa);
    expect((await s.call('GET', '/api/me')).body.user.email).toBe(ra.email);
    expect((await s.call('GET', '/api/me')).body.user.email).not.toBe(rb.email);
  });
});

describe('varios dispositivos', () => {
  it('agrega un segundo passkey, no permite repetirlo, y permite borrar uno pero nunca el último', async () => {
    const a1 = new SoftAuthenticator(), a2 = new SoftAuthenticator(), b = new Browser();
    await b.register(a1);
    const opt = await b.call('POST', '/api/auth/passkeys/options');
    expect(opt.body.excludeCredentials.map((c: { id: string }) => c.id)).toContain(a1.id);
    expect((await b.call('POST', '/api/auth/passkeys/verify', { response: a2.register(opt.body.challenge), name: 'Celular' })).status).toBe(200);
    const list = (await b.call('GET', '/api/auth/passkeys')).body;
    expect(list.passkeys.map((p: { name: string }) => p.name).sort()).toEqual(['Celular', 'Test']);

    const again = await b.call('POST', '/api/auth/passkeys/options');
    expect((await b.call('POST', '/api/auth/passkeys/verify', { response: a2.register(again.body.challenge) })).status).toBe(409);

    const [first, second] = list.passkeys;
    expect((await b.call('DELETE', `/api/auth/passkeys/${first.id}`)).status).toBe(200);
    expect((await b.call('DELETE', `/api/auth/passkeys/${second.id}`)).status).toBe(409);
    expect((await b.call('GET', '/api/auth/passkeys')).body.passkeys).toHaveLength(1);
    expect((await new Browser().login(a1)).status).toBe(401);           // el borrado revocó ese dispositivo
    expect((await new Browser().login(a2)).status).toBe(200);
  });

  it('se puede renombrar un passkey', async () => {
    const b = new Browser(); await b.register(new SoftAuthenticator());
    const id = (await b.call('GET', '/api/auth/passkeys')).body.passkeys[0].id;
    await b.call('PATCH', `/api/auth/passkeys/${id}`, { name: 'MacBook' });
    expect((await b.call('GET', '/api/auth/passkeys')).body.passkeys[0].name).toBe('MacBook');
  });

  it('el challenge de "agregar" no sirve para iniciar sesión ni para registrar otra cuenta', async () => {
    const b = new Browser(); await b.register(new SoftAuthenticator());
    const opt = await b.call('POST', '/api/auth/passkeys/options');
    const attacker = new Browser(); attacker.jar.set('ms_chal', b.jar.get('ms_chal')!);
    expect((await attacker.call('POST', '/api/auth/login/verify', { response: new SoftAuthenticator().assert(opt.body.challenge) })).status).toBe(400);
    expect((await attacker.call('POST', '/api/auth/register/verify', { response: new SoftAuthenticator().register(opt.body.challenge) })).status).toBe(400);
  });

  it('B no puede ver, renombrar ni borrar los passkeys de A; sin sesión todo da 401', async () => {
    const A = new Browser(), B = new Browser(); await A.register(new SoftAuthenticator()); await B.register(new SoftAuthenticator());
    const aId = (await A.call('GET', '/api/auth/passkeys')).body.passkeys[0].id;
    expect((await B.call('GET', '/api/auth/passkeys')).body.passkeys.map((p: { id: string }) => p.id)).not.toContain(aId);
    expect((await B.call('DELETE', `/api/auth/passkeys/${aId}`)).status).toBe(404);
    expect((await B.call('PATCH', `/api/auth/passkeys/${aId}`, { name: 'x' })).body.ok).toBe(false);
    for (const [m, u] of [['GET', '/api/auth/passkeys'], ['POST', '/api/auth/passkeys/options'], ['POST', '/api/auth/recovery-codes']] as const)
      expect((await new Browser().call(m, u)).status, u).toBe(401);
  });
});

describe('recuperación', () => {
  it('un código sirve una vez, inicia sesión y exige agregar un passkey nuevo', async () => {
    const b = new Browser(); const { email, ver } = await b.register(new SoftAuthenticator());
    const code = ver.body.recoveryCodes[0];
    const r = new Browser();
    const res = await r.call('POST', '/api/auth/recovery', { email, code: code.toLowerCase().replace(/-/g, ' ') });   // tolera formato
    expect(res.status).toBe(200);
    expect(res.body.mustAddPasskey).toBe(true);
    expect((await r.call('GET', '/api/me')).body.user.email).toBe(email);
    expect((await r.call('GET', '/api/auth/passkeys')).body.recoveryCodesLeft).toBe(7);
    expect((await new Browser().call('POST', '/api/auth/recovery', { email, code })).status).toBe(401);                  // ya usado
  });

  it('el código de una cuenta no abre otra; email o código inexistentes dan el mismo error', async () => {
    const A = new Browser(), B = new Browser();
    const ra = await A.register(new SoftAuthenticator()), rb = await B.register(new SoftAuthenticator());
    const a = await new Browser().call('POST', '/api/auth/recovery', { email: rb.email, code: ra.ver.body.recoveryCodes[0] });
    const b = await new Browser().call('POST', '/api/auth/recovery', { email: 'nadie@test.local', code: 'AAAA-BBBB-CCCC-DDDD' });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('regenerar invalida los códigos anteriores', async () => {
    const b = new Browser(); const { email, ver } = await b.register(new SoftAuthenticator());
    const fresh = (await b.call('POST', '/api/auth/recovery-codes')).body.recoveryCodes;
    expect(fresh).toHaveLength(8);
    expect((await new Browser().call('POST', '/api/auth/recovery', { email, code: ver.body.recoveryCodes[1] })).status).toBe(401);
    expect((await new Browser().call('POST', '/api/auth/recovery', { email, code: fresh[0] })).status).toBe(200);
  });

  it('flujo completo de pérdida de dispositivo: recuperar -> agregar passkey nuevo -> quitar el perdido', async () => {
    const lost = new SoftAuthenticator(), fresh = new SoftAuthenticator();
    const orig = new Browser(); const { email, ver } = await orig.register(lost);
    const r = new Browser();
    await r.call('POST', '/api/auth/recovery', { email, code: ver.body.recoveryCodes[0] });
    const opt = await r.call('POST', '/api/auth/passkeys/options');
    expect((await r.call('POST', '/api/auth/passkeys/verify', { response: fresh.register(opt.body.challenge), name: 'Nuevo' })).status).toBe(200);
    const lostId = (await r.call('GET', '/api/auth/passkeys')).body.passkeys.find((p: { name: string }) => p.name === 'Test').id;
    expect((await r.call('DELETE', `/api/auth/passkeys/${lostId}`)).status).toBe(200);
    expect((await new Browser().login(lost)).status).toBe(401);
    expect((await new Browser().login(fresh)).status).toBe(200);
  });
});

describe('límite de intentos', () => {
  it('la recuperación se bloquea tras 5 intentos fallidos por email (aunque el 6º sea correcto)', async () => {
    const b = new Browser(); const { email, ver } = await b.register(new SoftAuthenticator());
    for (let i = 0; i < 5; i++) expect((await new Browser().call('POST', '/api/auth/recovery', { email, code: `ZZZZ-ZZZZ-ZZZZ-ZZ${i}9` })).status).toBe(401);
    const blocked = await new Browser().call('POST', '/api/auth/recovery', { email, code: ver.body.recoveryCodes[0] });
    expect(blocked.status).toBe(429);
  });
  it('los endpoints públicos limitan por IP', async () => {
    const limited = await buildApp({ db, gateway, sessionSecret: SECRET, mailer: memoryMailer(), baseUrl: BASE, webauthn: WA, limiter: new RateLimiter() });
    let last = 0;
    for (let i = 0; i < 45; i++) last = (await limited.inject({ method: 'POST', url: '/api/auth/login/options' })).statusCode;
    expect(last).toBe(429);
    await limited.close();
  });
});

describe('sesión', () => {
  it('logout invalida la cookie del navegador y la sesión previa deja de ser enviada', async () => {
    const b = new Browser(); await b.register(new SoftAuthenticator());
    await b.call('POST', '/api/logout');
    expect(b.jar.has('ms_session')).toBe(false);
    expect((await b.call('GET', '/api/me')).status).toBe(401);
  });
});

describe('borrar la cuenta (API)', () => {
  const data = (b: Browser, n = 2) => Promise.all(Array.from({ length: n }, (_, i) =>
    b.call('POST', '/api/capture', { text: `nota ${i} ${Math.random()} para borrar` })));
  /** Intenta borrar: pide opciones y responde con el autenticador dado. */
  async function tryDelete(b: Browser, auth: SoftAuthenticator | null, confirmEmail: string, o: Parameters<SoftAuthenticator['assert']>[1] = {}) {
    const opt = await b.call('POST', '/api/account/delete/options');
    const response = auth ? auth.assert(opt.body.challenge, o) : { id: 'x', rawId: 'x', type: 'public-key', response: {} };
    return b.call('POST', '/api/account/delete', { response, confirmEmail });
  }
  const exists = async (email: string) => (await admin.query('SELECT 1 FROM users WHERE email=$1', [email])).rowCount === 1;

  it('el resumen muestra qué se va a borrar', async () => {
    const b = new Browser(); await b.register(new SoftAuthenticator()); await data(b, 3);
    expect((await b.call('GET', '/api/account/summary')).body).toMatchObject({ workspaces: 1, sources: 3, passkeys: 1 });
  });

  it('sin sesión, las tres rutas dan 401', async () => {
    for (const [m, u] of [['GET', '/api/account/summary'], ['POST', '/api/account/delete/options'], ['POST', '/api/account/delete']] as const)
      expect((await new Browser().call(m, u)).status, u).toBe(401);
  });

  it('una sesión robada NO alcanza: sin un passkey válido en el momento no se borra nada', async () => {
    const a = new SoftAuthenticator(), b = new Browser(); const { email } = await b.register(a); await data(b);
    const thief = new Browser(); thief.jar.set('ms_session', b.jar.get('ms_session')!);      // el ladrón tiene la cookie, no el dispositivo
    expect((await tryDelete(thief, null, email)).status).toBe(401);               // sin passkey
    expect((await tryDelete(thief, new SoftAuthenticator(), email)).status).toBe(401);      // otro autenticador cualquiera
    expect((await tryDelete(thief, a, email, { corruptSignature: true })).status).toBe(401);
    expect(await exists(email)).toBe(true);
  });

  it('el email de confirmación debe coincidir; el passkey debe ser de ESTA cuenta', async () => {
    const aa = new SoftAuthenticator(), bb = new SoftAuthenticator(), A = new Browser(), B = new Browser();
    const ra = await A.register(aa), rb = await B.register(bb);
    expect((await tryDelete(A, aa, 'otro@test.local')).body.error).toBe('confirmation_mismatch');
    // A intenta borrarse con el passkey de B (válido, pero de otra cuenta)
    const r = await tryDelete(A, bb, ra.email);
    expect(r.status).toBe(403);
    expect(await exists(ra.email)).toBe(true); expect(await exists(rb.email)).toBe(true);
  });

  it('el challenge de otro propósito no sirve (el de login no borra cuentas)', async () => {
    const a = new SoftAuthenticator(), b = new Browser(); const { email } = await b.register(a);
    const lo = await b.call('POST', '/api/auth/login/options');
    const r = await b.call('POST', '/api/account/delete', { response: a.assert(lo.body.challenge), confirmEmail: email });
    expect(r.status).toBe(400);
    expect(await exists(email)).toBe(true);
  });

  it('con passkey + email correctos: borra todo, cierra la sesión, y no queda forma de volver a entrar', async () => {
    const a = new SoftAuthenticator(), A = new Browser(); const { email, ver } = await A.register(a); await data(A, 3);
    const other = new SoftAuthenticator(), B = new Browser(); const rb = await B.register(other); await data(B, 2);
    const oldSession = A.jar.get('ms_session')!;

    const r = await tryDelete(A, a, email.toUpperCase());                  // el email se compara sin distinguir mayúsculas
    expect(r.status).toBe(200);
    expect(r.body.deleted).toMatchObject({ workspaces: 1, sources: 3, passkeys: 1 });
    expect(A.jar.has('ms_session')).toBe(false);
    expect(await exists(email)).toBe(false);

    const stale = new Browser(); stale.jar.set('ms_session', oldSession);   // la cookie vieja ya no sirve
    expect((await stale.call('GET', '/api/me')).status).toBe(401);
    expect((await new Browser().login(a)).status).toBe(401);                // su passkey ya no existe
    expect((await new Browser().call('POST', '/api/auth/recovery', { email, code: ver.body.recoveryCodes[0] })).status).toBe(401);

    expect((await B.call('GET', '/api/account/summary')).body).toMatchObject({ sources: 2 });   // B intacto
    expect((await new Browser().login(other)).status).toBe(200);
    expect(await exists(rb.email)).toBe(true);
  });

  it('una respuesta ya usada no puede repetirse (no se puede borrar dos veces)', async () => {
    const a = new SoftAuthenticator(), b = new Browser(); const { email } = await b.register(a);
    const opt = await b.call('POST', '/api/account/delete/options');
    const resp = a.assert(opt.body.challenge);
    const cookies = new Map(b.jar);
    expect((await b.call('POST', '/api/account/delete', { response: resp, confirmEmail: email })).status).toBe(200);
    const replay = new Browser(); cookies.forEach((v, k) => replay.jar.set(k, v));
    expect((await replay.call('POST', '/api/account/delete', { response: resp, confirmEmail: email })).status).toBe(401);
  });

  it('se rechaza (409) si la cuenta tiene un workspace compartido, y no se borra nada', async () => {
    const a = new SoftAuthenticator(), A = new Browser(); const { email } = await A.register(a); await data(A);
    const rb = await new Browser().register(new SoftAuthenticator());
    const wsA = (await A.call('GET', '/api/me')).body.workspaces[0].id;
    const uB = (await admin.query('SELECT id FROM users WHERE email=$1', [rb.email])).rows[0].id;
    await admin.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [wsA, uB]);
    const r = await tryDelete(A, a, email);
    expect(r.status).toBe(409); expect(r.body.error).toBe('workspace_shared');
    expect(await exists(email)).toBe(true);
    expect((await A.call('GET', '/api/account/summary')).body.sources).toBe(2);
  });

  it('después de borrar, el mismo email se puede registrar de nuevo y arranca vacío', async () => {
    const a = new SoftAuthenticator(), A = new Browser(); const { email } = await A.register(a); await data(A);
    await tryDelete(A, a, email);
    const again = new Browser();
    const { ver } = await again.register(new SoftAuthenticator(), email);
    expect(ver.status).toBe(200);
    expect((await again.call('GET', '/api/account/summary')).body).toMatchObject({ sources: 0, entities: 0, passkeys: 1 });
  });

  it('la cookie del desafío es alcanzable desde TODAS las rutas que la usan (un navegador real filtra por Path)', async () => {
    const b = new Browser(); await b.register(new SoftAuthenticator());
    const users: [string, string][] = [['/api/account/delete/options', '/api/account/delete'], ['/api/auth/passkeys/options', '/api/auth/passkeys/verify'], ['/api/auth/login/options', '/api/auth/login/verify']];
    for (const [issuer, consumer] of users) {
      await b.call('POST', issuer);
      expect(b.paths.get('ms_chal'), issuer).toBeDefined();
      expect(consumer.startsWith(b.paths.get('ms_chal')!), `${issuer} -> ${consumer}`).toBe(true);
    }
  });
});
