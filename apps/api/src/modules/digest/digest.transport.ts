/**
 * Mail transport contract used by the Digest agent.
 *
 * This is a re-declaration of the Email agent's `MailTransport` interface
 * (modules/email/email.transport.ts) — kept as a local symbol so the digest
 * module doesn't reach across an unrelated module's surface for a stable
 * type. The shapes are nominally identical: the same concrete
 * `LoggingTransport` / SMTP transport satisfies both.
 *
 * The interface is intentionally minimal — one method, fire-and-forget on
 * success, plus an optional `outbox` so the test suite can assert on body
 * content without spying on the logger.
 */
export interface DigestOutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface DigestMailTransport {
  send(message: DigestOutgoingEmail): Promise<void>;
  readonly outbox?: readonly DigestOutgoingEmail[];
}
