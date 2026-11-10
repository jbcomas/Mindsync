/**
 * Configuración y validaciones de arranque. Función PURA (recibe el entorno) para poder probarla.
 * Principio: si el servidor va a estar accesible desde internet, se niega a arrancar con configuraciones inseguras.
 */
export interface Config {
  origin: string; rpID: string; port: number; host: string; isLocal: boolean; https: boolean; prod: boolean;
  sessionSecret: string; devLogin: boolean; trustProxy: boolean;
  registration: { open: boolean; allowed: string[] };
  smtp?: { url: string; from: string }; devMail: boolean; warnings: string[];
}

const DEV_SECRET = 'dev-only-secret-change-me';
export const DEFAULT_DEV_SECRET = DEV_SECRET;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const warnings: string[] = [];
  const port = Number(env.PORT ?? 3000);
  const raw = env.ORIGIN ?? `http://localhost:${port}`;
  if (/\s/.test(raw)) throw new Error(`ORIGIN contiene espacios o tabulaciones (${JSON.stringify(raw)}). Corregilo en el .env: tiene que ser, por ejemplo, https://mindsync.tu-dominio.com`);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`ORIGIN no es una URL válida: ${raw}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('ORIGIN debe empezar con http:// o https://');
  const origin = url.origin;
  if (raw.replace(/\/$/, '') !== origin) throw new Error(`ORIGIN debe ser solo el origen (esquema + dominio), sin ruta ni parámetros: ${origin}`);

  const hostname = url.hostname;
  const isLocal = LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
  const https = url.protocol === 'https:';
  const prod = env.NODE_ENV === 'production';
  const rpID = env.RP_ID ?? hostname;
  if (/\s/.test(rpID)) throw new Error('RP_ID contiene espacios o tabulaciones');
  if (!(hostname === rpID || hostname.endsWith('.' + rpID))) throw new Error(`RP_ID (${rpID}) debe ser el dominio de ORIGIN (${hostname}) o un dominio padre suyo: si no, el navegador rechaza las passkeys`);

  const host = env.HOST ?? '127.0.0.1';
  const exposed = !isLocal || prod;
  const sessionSecret = env.SESSION_SECRET ?? (exposed ? '' : DEV_SECRET);
  if (exposed) {
    if (!sessionSecret || sessionSecret === DEV_SECRET) throw new Error('SESSION_SECRET es obligatorio cuando el servidor es accesible por un dominio (un secreto conocido permitiría falsificar sesiones)');
    if (sessionSecret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres');
  }
  if (!isLocal && !https) throw new Error('Un ORIGIN que no es localhost debe usar https:// (las passkeys y las cookies seguras lo exigen)');

  const devLogin = env.DEV_LOGIN === '1';
  if (devLogin && exposed) throw new Error('DEV_LOGIN no puede activarse en un servidor accesible por un dominio ni en producción (permite entrar sin passkey)');

  // Correo.
  let smtp: Config['smtp'];
  if (env.SMTP_URL) {
    if (!env.MAIL_FROM) throw new Error('MAIL_FROM es obligatorio cuando se define SMTP_URL');
    smtp = { url: env.SMTP_URL, from: env.MAIL_FROM };
  }
  const devMail = !smtp;
  if (devMail && prod) throw new Error('SMTP_URL y MAIL_FROM son obligatorios en producción');
  if (devMail && !isLocal) {
    if (env.ALLOW_DEV_MAIL !== '1') throw new Error('Sin SMTP_URL, la verificación de email usa una bandeja de desarrollo que muestra el enlace en la propia app: cualquiera podría "verificar" cualquier email. En un dominio público solo se permite con ALLOW_DEV_MAIL=1 (y entonces "email verificado" NO es confiable).');
    warnings.push('ALLOW_DEV_MAIL=1: sin SMTP, "email verificado" no prueba nada. Solo para pruebas.');
  }

  // Registro: abierto solo en local. En un dominio público, solo emails invitados (cada cuenta puede gastar tus claves de IA).
  const allowed = (env.ALLOWED_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const e of allowed) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`ALLOWED_EMAILS contiene un email inválido: ${e}`);
  const wantOpen = (env.REGISTRATION ?? (isLocal ? 'open' : 'closed')) === 'open';
  if (wantOpen && !isLocal && env.ALLOW_OPEN_REGISTRATION !== '1')
    throw new Error('REGISTRATION=open en un dominio público permite que cualquiera cree cuentas y gaste tus claves de IA. Usá ALLOWED_EMAILS, o confirmalo con ALLOW_OPEN_REGISTRATION=1.');
  if (!wantOpen && !allowed.length) warnings.push('Registro cerrado y ALLOWED_EMAILS vacío: nadie nuevo puede crear una cuenta (las cuentas existentes siguen entrando).');

  // Detrás de un proxy/túnel todas las conexiones llegan desde 127.0.0.1: sin trustProxy los límites de intentos se comparten entre todos.
  // Es seguro confiar en X-Forwarded-For solo si el puerto no está expuesto directamente (HOST en loopback).
  const loopbackBind = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const trustProxy = env.TRUST_PROXY !== undefined ? env.TRUST_PROXY === '1' : (!isLocal && loopbackBind);
  if (trustProxy && !loopbackBind) warnings.push('TRUST_PROXY=1 con HOST expuesto: cualquiera puede falsificar su IP (X-Forwarded-For) y saltear los límites de intentos.');

  return { origin, rpID, port, host, isLocal, https, prod, sessionSecret, devLogin, trustProxy, registration: { open: wantOpen, allowed }, smtp, devMail, warnings };
}
