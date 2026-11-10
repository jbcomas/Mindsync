import nodemailer, { type Transporter } from 'nodemailer';

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { readonly kind: 'smtp' | 'console' | 'memory'; send(mail: Mail): Promise<void> }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export { esc as escapeHtml };

/** Correo de verificación. El token va en el FRAGMENTO (#): no viaja al servidor, no queda en logs ni en el Referer. */
export function verificationMail(p: { to: string; link: string; ttlHours: number }): Mail {
  const text = [
    'Hola,', '',
    'Para confirmar tu email en MindSync, abrí este enlace y tocá "Confirmar mi email":', '', p.link, '',
    `El enlace vale ${p.ttlHours} horas y se puede usar una sola vez.`, '',
    'Si no creaste una cuenta en MindSync, ignorá este mensaje: no pasa nada y nadie obtiene acceso a nada.',
  ].join('\n');
  const html = `<p>Hola,</p><p>Para confirmar tu email en MindSync, abrí este enlace y tocá <strong>Confirmar mi email</strong>:</p>
<p><a href="${esc(p.link)}">${esc(p.link)}</a></p><p>El enlace vale ${p.ttlHours} horas y se puede usar una sola vez.</p>
<p>Si no creaste una cuenta en MindSync, ignorá este mensaje: no pasa nada y nadie obtiene acceso a nada.</p>`;
  return { to: p.to, subject: 'Confirmá tu email en MindSync', text, html };
}

/** SMTP real (producción). `url` tipo smtps://usuario:clave@host:465. */
export function smtpMailer(opts: { url?: string; from: string; transport?: Transporter }): Mailer {
  const transport = opts.transport ?? nodemailer.createTransport(opts.url!);
  return {
    kind: 'smtp',
    async send(m) { await transport.sendMail({ from: opts.from, to: m.to, subject: m.subject, text: m.text, html: m.html }); },
  };
}

/** Desarrollo sin SMTP: NO envía nada. Guarda los correos en memoria y muestra el enlace en el log del servidor. */
export function consoleMailer(log: (s: string) => void = console.log): Mailer & { outbox: Mail[] } {
  const outbox: Mail[] = [];
  return { kind: 'console', outbox, async send(m) { outbox.push(m); if (outbox.length > 50) outbox.shift(); log(`[correo de desarrollo, no enviado] para ${m.to}: ${m.subject}\n${m.text.split('\n').find(l => l.startsWith('http')) ?? ''}`); } };
}

/** Para tests. */
export function memoryMailer(): Mailer & { sent: Mail[]; failNext: boolean } {
  const sent: Mail[] = [];
  const m = { kind: 'memory' as const, sent, failNext: false, async send(mail: Mail) { if (m.failNext) { m.failNext = false; throw new Error('smtp caído'); } sent.push(mail); } };
  return m;
}
