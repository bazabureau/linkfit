import { type Logger } from "pino";

/**
 * Minimal transport contract — narrow enough that:
 *   - the test suite can implement it with a plain in-memory list, and
 *   - a thin adapter around `nodemailer.createTransport(...).sendMail({...})`
 *     satisfies it without leaking nodemailer types up the stack.
 *
 * We model an "outbox" rather than a fire-and-forget callback so tests can
 * assert on body content (the magic link is buried inside `text`/`html`).
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  send(message: OutgoingEmail): Promise<void>;
  /** Optional health probe used by /health/ready when SMTP is configured. */
  verify?(): Promise<void>;
  /** Optional capture — tests provide a real implementation; production
   *  transports just return `[]`. Kept on the interface so we never have
   *  to cast in test code. */
  readonly outbox?: readonly OutgoingEmail[];
}

/**
 * Dev/test fallback. Logs every outgoing message at INFO level — the magic
 * link is wrapped in `**` markers so it's easy to scan terminal output:
 *
 *     [email] verify link → **https://app/verify?token=...**
 *
 * Also keeps an in-memory `outbox` so unit tests can inspect what was sent
 * without intercepting the logger.
 */
export class LoggingTransport implements MailTransport {
  private readonly _outbox: OutgoingEmail[] = [];
  public get outbox(): readonly OutgoingEmail[] { return this._outbox; }

  constructor(private readonly logger: Logger) {}

  public send(message: OutgoingEmail): Promise<void> {
    this._outbox.push(message);
    this.logger.info(
      { to: message.to, subject: message.subject },
      `[email] **${message.subject}** to ${message.to}\n  ${message.text}`,
    );
    return Promise.resolve();
  }

  public verify(): Promise<void> {
    return Promise.resolve();
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/**
 * Build the SMTP transport. We dynamic-import nodemailer so the module
 * stays loadable in environments that haven't installed it (the test suite
 * uses `LoggingTransport`, so this code path never executes there).
 *
 * The factory is intentionally async — wiring happens once at server boot,
 * not per-request, so the import cost is paid up-front.
 */
export async function buildSmtpTransport(
  config: SmtpConfig,
  from: string,
  logger: Logger,
): Promise<MailTransport> {
  interface NodemailerLike {
    createTransport: (opts: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
    }) => {
      sendMail: (opts: {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
      }) => Promise<unknown>;
      verify: () => Promise<unknown>;
    };
  }
  let mod: NodemailerLike;
  try {
    mod = await import("nodemailer");
  } catch (err) {
    logger.warn(
      { err },
      "nodemailer not installed; falling back to LoggingTransport",
    );
    return new LoggingTransport(logger);
  }

  const inner = mod.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  return {
    async send(message): Promise<void> {
      await inner.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
    async verify(): Promise<void> {
      await inner.verify();
    },
  };
}
