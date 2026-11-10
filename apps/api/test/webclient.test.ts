// Ejecuta el código WebAuthn REAL del navegador (extraído de apps/web/app.js) contra el servidor, con un autenticador por
// software que habla en los tipos del navegador (ArrayBuffer). Verifica las conversiones que suelen romper WebAuthn.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantDb, urls } from '@mindsync/db';
import { createGateway, fakeProvider } from '@mindsync/llm';
import { buildApp } from '../src/app.js';
import { memoryMailer } from '../src/mailer.js';
import { SoftAuthenticator } from './authenticator.js';

const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/app.js'), 'utf8');
const start = src.indexOf('const b64uToBuf'), end = src.indexOf('const hasPasskeys');
if (start < 0 || end < 0) throw new Error('No se encontró el bloque WebAuthn en app.js');
const client = new Function(`${src.slice(start, end)}; return { b64uToBuf, bufToB64u, creationOptions, requestOptions, credentialToJSON, verifyTokenFromHash };`)() as {
  verifyTokenFromHash(h: string): string | null;
  b64uToBuf(s: string): ArrayBuffer; bufToB64u(b: ArrayBuffer): string; creationOptions(j: any): any; requestOptions(j: any): any; credentialToJSON(c: any): any;
};

const BASE = 'http://localhost:3000';
const SECRET = 's';
const db = createTenantDb(urls.app, { max: 3 });
const f = fakeProvider(() => ({ items: [], relations: [] }), 'f'); const route = [{ provider: 'f', model: 'm' }];
const gateway = createGateway({ providers: { f }, routes: { classify: route, extract: route, relate: route, ideate: route, write: route }, embedding: { provider: 'f', model: 'e', dimensions: 1024 } });
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { app = await buildApp({ db, gateway, sessionSecret: SECRET, mailer: memoryMailer(), baseUrl: BASE, webauthn: { rpID: 'localhost', rpName: 'MindSync', origins: ['http://localhost:3000'] } }); });
afterAll(async () => { await app.close(); await db.close(); });

const ab = (s: string) => client.b64uToBuf(s);
const post = async (url: string, payload?: unknown, cookie = '') => {
  const r = await app.inject({ method: 'POST', url, payload: payload as object, headers: cookie ? { cookie } : {} });
  const sc = ([] as string[]).concat(r.headers['set-cookie'] ?? []).map(c => c.split(';')[0]!).filter(c => !c.endsWith('='));
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : {}, cookies: sc };
};

/** Lo que haría el navegador: recibe las opciones YA convertidas (ArrayBuffer) y devuelve una credencial con ArrayBuffer. */
function browserCreate(auth: SoftAuthenticator, opts: any) {
  expect(opts.challenge).toBeInstanceOf(ArrayBuffer);
  expect(opts.user.id).toBeInstanceOf(ArrayBuffer);
  expect(opts.user.id.byteLength).toBe(16);
  const j = auth.register(client.bufToB64u(opts.challenge));
  return { id: j.id, rawId: ab(j.rawId), type: j.type, authenticatorAttachment: j.authenticatorAttachment,
    response: { clientDataJSON: ab(j.response.clientDataJSON), attestationObject: ab(j.response.attestationObject), getTransports: () => ['internal'] },
    getClientExtensionResults: () => ({}) };
}
function browserGet(auth: SoftAuthenticator, opts: any) {
  expect(opts.challenge).toBeInstanceOf(ArrayBuffer);
  const j = auth.assert(client.bufToB64u(opts.challenge));
  return { id: j.id, rawId: ab(j.rawId), type: j.type, authenticatorAttachment: null,
    response: { clientDataJSON: ab(j.response.clientDataJSON), authenticatorData: ab(j.response.authenticatorData), signature: ab(j.response.signature), userHandle: ab(j.response.userHandle) },
    getClientExtensionResults: () => ({}) };
}

describe('código WebAuthn del navegador (app.js) contra el servidor real', () => {
  it('base64url: ida y vuelta sin pérdida, con relleno y bytes altos', () => {
    for (const len of [0, 1, 2, 3, 31, 32, 33, 255]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 200) & 255);
      const s = client.bufToB64u(bytes.buffer);
      expect(s).not.toMatch(/[+/=]/);
      expect(new Uint8Array(client.b64uToBuf(s))).toEqual(bytes);
    }
  });

  it('registro: opciones del servidor -> create() -> JSON -> el servidor lo acepta', async () => {
    const auth = new SoftAuthenticator();
    const email = `web-${Date.now()}@test.local`;
    const o = await post('/api/auth/register/options', { email });
    const cred = browserCreate(auth, client.creationOptions(o.body));
    const json = client.credentialToJSON(cred);
    expect(json.response.attestationObject).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(json.response.transports).toEqual(['internal']);
    const v = await post('/api/auth/register/verify', { response: json, name: 'Mac' }, o.cookies.join('; '));
    expect(v.status).toBe(200);
    expect(v.body.recoveryCodes).toHaveLength(8);
  });

  it('login: opciones -> get() -> JSON (userHandle y attachment null) -> sesión iniciada', async () => {
    const auth = new SoftAuthenticator();
    const email = `web-${Date.now()}-b@test.local`;
    const ro = await post('/api/auth/register/options', { email });
    await post('/api/auth/register/verify', { response: client.credentialToJSON(browserCreate(auth, client.creationOptions(ro.body))) }, ro.cookies.join('; '));

    const lo = await post('/api/auth/login/options');
    const opts = client.requestOptions(lo.body);
    expect(opts.allowCredentials).toEqual([]);                     // passkey descubrible: sin lista de credenciales
    const json = client.credentialToJSON(browserGet(auth, opts));
    expect(json.authenticatorAttachment).toBeUndefined();           // null -> se omite
    const v = await post('/api/auth/login/verify', { response: json }, lo.cookies.join('; '));
    expect(v.status).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: v.cookies.find(c => c.startsWith('ms_session='))! } });
    expect(JSON.parse(me.body).user.email).toBe(email);
  });

  it('agregar dispositivo: excludeCredentials llega como ArrayBuffer', async () => {
    const a1 = new SoftAuthenticator(), email = `web-${Date.now()}-c@test.local`;
    const ro = await post('/api/auth/register/options', { email });
    const rv = await post('/api/auth/register/verify', { response: client.credentialToJSON(browserCreate(a1, client.creationOptions(ro.body))) }, ro.cookies.join('; '));
    const session = rv.cookies.find(c => c.startsWith('ms_session='))!;
    const ao = await post('/api/auth/passkeys/options', undefined, session);
    const opts = client.creationOptions(ao.body);
    expect(opts.excludeCredentials).toHaveLength(1);
    expect(opts.excludeCredentials[0].id).toBeInstanceOf(ArrayBuffer);
    expect(client.bufToB64u(opts.excludeCredentials[0].id)).toBe(a1.id);
    const a2 = new SoftAuthenticator();
    const v = await post('/api/auth/passkeys/verify', { response: client.credentialToJSON(browserCreate(a2, opts)), name: 'Celular' }, [session, ...ao.cookies].join('; '));
    expect(v.status).toBe(200);
  });

  it('borrar cuenta: se pide como el login (sin allowCredentials, para que Chrome no ofrezca el QR) y la respuesta es aceptada', async () => {
    const auth = new SoftAuthenticator(), email = `web-${Date.now()}-d@test.local`;
    const ro = await post('/api/auth/register/options', { email });
    const rv = await post('/api/auth/register/verify', { response: client.credentialToJSON(browserCreate(auth, client.creationOptions(ro.body))) }, ro.cookies.join('; '));
    const session = rv.cookies.find(c => c.startsWith('ms_session='))!;
    const o = await post('/api/account/delete/options', undefined, session);
    const opts = client.requestOptions(o.body);
    expect(opts.allowCredentials).toEqual([]);
    expect(o.body.allowCredentials ?? []).toEqual([]);
    const v = await post('/api/account/delete', { response: client.credentialToJSON(browserGet(auth, opts)), confirmEmail: email }, [session, ...o.cookies].join('; '));
    expect(v.status).toBe(200);
    expect(v.body.deleted.workspaces).toBe(1);
  });

  it('verifyTokenFromHash: lee el token del fragmento y rechaza todo lo demás', () => {
    const t = 'A'.repeat(43);
    expect(client.verifyTokenFromHash(`#verify=${t}`)).toBe(t);
    for (const bad of ['', '#', '#verify=', '#verify=corto', `#verify=${t}&x=1`, `#other=${t}`, `#verify=${t}<script>`, `verify=${t}`, `#verify=${'A'.repeat(101)}`, undefined as unknown as string])
      expect(client.verifyTokenFromHash(bad), String(bad)).toBeNull();
  });
});
