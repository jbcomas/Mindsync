import pg from 'pg';
import { createTenantDb, urls } from '@mindsync/db';
import { defaultGateway } from '@mindsync/llm';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { consoleMailer, smtpMailer } from './mailer.js';

// Toda la validación vive en loadConfig (con tests): si la configuración es insegura, no arranca.
const cfg = loadConfig();

let devLoginResolver: ((email: string) => Promise<string>) | undefined;
if (cfg.devLogin) {
  const admin = new pg.Pool({ connectionString: urls.admin, max: 2 });
  devLoginResolver = async email => {
    const e = email.toLowerCase();
    const found = await admin.query('SELECT id FROM users WHERE email = $1', [e]);
    return found.rows[0]?.id ?? (await admin.query('SELECT ms_signup($1) AS id', [e])).rows[0].id;
  };
  console.warn('⚠ DEV_LOGIN=1: login sin passkey habilitado (solo desarrollo local)');
}
const mailer = cfg.smtp ? smtpMailer({ url: cfg.smtp.url, from: cfg.smtp.from }) : consoleMailer();
if (cfg.devMail) console.warn('⚠ Sin SMTP_URL: los correos NO se envían (se muestran en el log y en la app, solo desarrollo)');
for (const w of cfg.warnings) console.warn('⚠', w);

const app = await buildApp({
  db: createTenantDb(urls.app), gateway: defaultGateway(), sessionSecret: cfg.sessionSecret, secureCookies: cfg.https,
  webauthn: { rpID: cfg.rpID, rpName: 'MindSync', origins: [cfg.origin] }, devLoginResolver, mailer, baseUrl: cfg.origin,
  trustProxy: cfg.trustProxy, registration: cfg.registration, https: cfg.https,
});
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`MindSync en ${cfg.origin}  (passkeys rpID=${cfg.rpID} · escucha ${cfg.host}:${cfg.port} · registro ${cfg.registration.open ? 'ABIERTO' : `solo invitados (${cfg.registration.allowed.length})`} · proxy ${cfg.trustProxy ? 'confiable' : 'no'})`);
