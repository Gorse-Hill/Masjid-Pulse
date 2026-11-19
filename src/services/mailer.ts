/**
 * Outgoing email. SMTP is configured ONLY from environment variables (never stored on disk):
 *   SMTP_HOST, SMTP_PORT (465 = implicit TLS), SMTP_USER, SMTP_PASS, MAIL_FROM
 * Without SMTP_HOST the "dev outbox" mailer is used: messages are logged to the console and kept in
 * memory, so development and tests work without any mail account.
 */
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Minimal transport interface (nodemailer transporters satisfy it; tests pass a fake). */
export interface MailTransport {
  sendMail(msg: MailMessage & { from: string }): Promise<unknown>;
}

export interface Mailer {
  mode: 'smtp' | 'dev';
  from: string;
  send(msg: MailMessage): Promise<void>;
  /** Dev mode only: messages "sent" so far (newest last). */
  outbox: (MailMessage & { from: string; sentAt: string })[];
}

export interface SmtpEnv {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM?: string;
}

/** nodemailer options derived from env (exported for tests; contains the password in memory only). */
export function smtpOptionsFromEnv(env: SmtpEnv) {
  if (!env.SMTP_HOST) return null;
  // A username without a password cannot authenticate: treat SMTP as not configured yet.
  if (env.SMTP_USER && !env.SMTP_PASS) return null;
  const port = Number(env.SMTP_PORT || 465);
  return {
    host: env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS (e.g. smtp.gmail.com:465); 587 = STARTTLS
    requireTLS: port !== 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  };
}

export function createMailer(
  env: SmtpEnv = process.env,
  opts: { transport?: MailTransport; log?: (line: string) => void; quiet?: boolean } = {},
): Mailer {
  const from =
    env.MAIL_FROM ||
    (env.SMTP_USER ? `Masjid Pulse <${env.SMTP_USER}>` : 'Masjid Pulse <no-reply@localhost>');
  const smtp = smtpOptionsFromEnv(env);
  const transport: MailTransport | null = opts.transport ?? (smtp ? nodemailer.createTransport(smtp) : null);
  const log = opts.log ?? ((line: string) => console.log(line));
  const outbox: Mailer['outbox'] = [];
  if (!transport) {
    if (env.SMTP_HOST && !opts.quiet)
      log(
        `[mail] WARNING: SMTP_HOST is set but SMTP_PASS is missing - email is DISABLED; messages (with their links) are written to this log instead.`,
      );
    return {
      mode: 'dev',
      from,
      outbox,
      async send(msg) {
        outbox.push({ ...msg, from, sentAt: new Date().toISOString() });
        if (outbox.length > 200) outbox.shift();
        if (!opts.quiet) log(`[dev-mail] To: ${msg.to} | Subject: ${msg.subject}\n${msg.text}\n[/dev-mail]`);
      },
    };
  }
  return {
    mode: 'smtp',
    from,
    outbox,
    async send(msg) {
      await transport.sendMail({ ...msg, from });
    },
  };
}
