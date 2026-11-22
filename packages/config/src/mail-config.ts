import { z } from 'zod';
import { secret } from './secrets';

/**
 * The mail transport's own configuration (ISSUE-780): the sender, the
 * provider key, its webhook signing secret and the recipient hash secret.
 * Every mail purpose (auth, beta access) reads it, and nothing else, so an
 * auth-only misconfiguration never stops beta mail.
 */
export const mailFields = {
  /**
   * 64 characters from 32 random bytes (hex); see `bun auth:provision`.
   * Keys `recipientKey` (the suppression ledger and per-recipient
   * rate-limit buckets) independently of `BETTER_AUTH_SECRET`, so rotating
   * the session-signing secret can never desynchronize them (ADR 0044,
   * ISSUE-141).
   */
  RECIPIENT_HASH_SECRET: secret(z.string().regex(/^\S{64}$/)),
  RESEND_API_KEY: secret(z.string().regex(/^\S+$/)),
  /** Sender email header value; newlines and malformed mailboxes are rejected. */
  EMAIL_FROM: z
    .string()
    .refine(
      (value) =>
        /^(?:[^<>\r\n]+ <[^\s@<>]+@[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+)$/.test(
          value,
        ),
      'Expected an email address or display name with an email address',
    ),
  /** Resend (Svix) signing secret for delivery webhooks; required in production. */
  RESEND_WEBHOOK_SECRET: secret(
    z.string().regex(/^whsec_[A-Za-z0-9+/=]{16,}$/),
  ).optional(),
  // Required, no default: see deploymentIdentityFields.NODE_ENV.
  NODE_ENV: z.enum(['development', 'test', 'production']),
};
const mailConfigSchema = z
  .object(mailFields)
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && !config.RESEND_WEBHOOK_SECRET)
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_WEBHOOK_SECRET'],
        message: 'Production requires the webhook signing secret',
      });
  })
  .transform(({ NODE_ENV: _nodeEnv, ...mail }) => mail);
export type MailConfig = z.infer<typeof mailConfigSchema>;
/** Validation reports field names only: never echo secret values. */
export function readMailConfig(
  env: Record<string, string | undefined>,
): MailConfig {
  const result = mailConfigSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid mail configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return result.data;
}
