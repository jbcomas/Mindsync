import type { FastifyInstance } from 'fastify';
import { SoftAuthenticator } from './authenticator.js';

/** Un "navegador": guarda cookies entre pedidos y las filtra por Path como uno real. */
export class Browser {
  jar = new Map<string, string>();
  /** Path de cada cookie: solo se envía a URLs dentro de ese path. */
  paths = new Map<string, string>();
  constructor(private getApp: () => FastifyInstance) {}
  async call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    const cookie = [...this.jar].filter(([k]) => url.startsWith(this.paths.get(k) ?? '/')).map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await this.getApp().inject({ method, url, payload: payload as object, headers: cookie ? { cookie } : {} });
    for (const sc of ([] as string[]).concat(r.headers['set-cookie'] ?? [])) {
      const [kv, ...attrs] = sc.split(';'); const i = kv!.indexOf('='); const k = kv!.slice(0, i), v = kv!.slice(i + 1);
      const path = attrs.map(x => x.trim()).find(x => /^Path=/i.test(x))?.slice(5) ?? '/';
      if (!v || attrs.some(x => /Max-Age=0/i.test(x))) { this.jar.delete(k); this.paths.delete(k); } else { this.jar.set(k, v); this.paths.set(k, path); }
    }
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : {}, raw: r };
  }
  /** Registro completo con un autenticador; devuelve el email y los códigos. */
  async register(auth: SoftAuthenticator, email = `pk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`) {
    const opt = await this.call('POST', '/api/auth/register/options', { email });
    const ver = await this.call('POST', '/api/auth/register/verify', { response: auth.register(opt.body.challenge), name: 'Test' });
    return { email, opt, ver };
  }
  async login(auth: SoftAuthenticator, o: Parameters<SoftAuthenticator['assert']>[1] = {}) {
    const opt = await this.call('POST', '/api/auth/login/options');
    return this.call('POST', '/api/auth/login/verify', { response: auth.assert(opt.body.challenge, o) });
  }
}
