import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import type { Clock } from '@daisy/clock';
import type { Fetch } from '../features/auth/mail';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** One sign-in message as the dev capture keeps it. */
export type CapturedMail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** UTC ISO timestamp the message was captured. */
  readonly at: string;
};

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The file dev mail is captured to, or null when capture is off. Capture is a
 * local-development convenience for signing in without Resend: the real
 * magic-link flow runs and only the outbound mail is kept in a file instead
 * of sent. It refuses production outright, and names the field only.
 */
export function readDevMailFile(env: Env): string | null {
  const file = env.DEV_MAIL_CAPTURE;
  if (file === undefined || file === '') return null;
  if (env.NODE_ENV === 'production')
    throw new Error(
      'Invalid configuration: DEV_MAIL_CAPTURE is development-only',
    );
  if (!isAbsolute(file))
    throw new Error(
      'Invalid configuration: DEV_MAIL_CAPTURE must be an absolute path',
    );
  return file;
}

/**
 * Outbound HTTP with the Resend mail call answered locally: the message is
 * recorded and the sender is told it was accepted. Every other request goes
 * to the real network unchanged.
 */
export function captureMail({
  downstream,
  record,
  clock,
}: {
  readonly downstream: Fetch;
  readonly record: (mail: CapturedMail) => void;
  readonly clock: Clock;
}): Fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== RESEND_ENDPOINT) return downstream(input, init);
    const body = JSON.parse(String(init?.body)) as {
      to: string[];
      subject: string;
      text: string;
    };
    record({
      to: (body.to[0] ?? '').toLowerCase(),
      subject: body.subject,
      text: body.text,
      at: clock.now(),
    });
    return Response.json({ id: 'msg_dev_capture' });
  };
}

/** Appends each captured mail to the file as one JSON line. */
export const fileRecorder =
  (file: string) =>
  (mail: CapturedMail): void => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(mail)}\n`);
  };
