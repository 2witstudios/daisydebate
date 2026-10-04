import { existsSync, readFileSync } from 'node:fs';

/**
 * `bun dev:login [email] [--print] [--latest]`: signs in to the local dev
 * server without real email. It asks the running server for a magic link,
 * reads the message the server captured to `DEV_MAIL_CAPTURE` (a
 * local-development file; see docs/development/local-development.md), and
 * opens the confirm page in the browser. With `--latest` it requests nothing:
 * it opens the newest captured link, for when the sign-in form was already
 * used. The real sign-in flow runs; only the mail is read from a file.
 */

export const defaultEmail = 'dev@example.test';

type CapturedLine = { readonly to?: string; readonly text?: string };

const parseLine = (line: string): CapturedLine => {
  try {
    return JSON.parse(line) as CapturedLine;
  } catch {
    return {};
  }
};

/**
 * The confirm link in the newest message after the first `seen` lines: the
 * one to `email`, or to anyone when `email` is null.
 */
export function newLinkFor(
  lines: readonly string[],
  email: string | null,
  seen: number,
): string | null {
  const wanted = email?.toLowerCase() ?? null;
  for (const line of lines.slice(seen).reverse()) {
    const mail = parseLine(line);
    if (wanted !== null && mail.to !== wanted) continue;
    const link = mail.text?.match(/https?:\/\/\S+/)?.[0];
    if (link) return link;
  }
  return null;
}

const linesOf = (file: string): readonly string[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];

type Options = {
  /** The address to sign in as; null with `--latest` and no address. */
  readonly email: string | null;
  readonly print: boolean;
  readonly latest: boolean;
};

export function parseArgs(args: readonly string[]): Options {
  const print = args.includes('--print');
  const latest = args.includes('--latest');
  const given = args.find((arg) => !arg.startsWith('--'));
  return { email: given ?? (latest ? null : defaultEmail), print, latest };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { email, print, latest } = parseArgs(Bun.argv.slice(2));
  const file = process.env.DEV_MAIL_CAPTURE;
  const appUrl = process.env.PUBLIC_APP_URL;
  if (!file || !appUrl) {
    console.error(
      'Set DEV_MAIL_CAPTURE (an absolute file path) and PUBLIC_APP_URL in .env, then restart `bun dev`.',
    );
    process.exit(1);
  }
  if (latest) {
    const link = newLinkFor(linesOf(file), email, 0);
    if (!link) {
      console.error(
        'No captured sign-in mail yet. Use the form, or run `bun dev:login`.',
      );
      process.exit(1);
    }
    console.log(`Sign in: ${link}`);
    if (!print) Bun.spawn(['open', link]);
    return;
  }
  const requested = email ?? defaultEmail;
  const seen = linesOf(file).length;
  const response = await fetch(`${appUrl}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: appUrl },
    body: JSON.stringify({ email: requested, callbackURL: '/train' }),
  }).catch(() => null);
  if (!response?.ok) {
    console.error(
      `The dev server did not accept the request (${response?.status ?? 'unreachable'}). Is \`bun dev\` running at ${appUrl}?`,
    );
    process.exit(1);
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const link = newLinkFor(linesOf(file), requested, seen);
    if (link) {
      console.log(`Sign in as ${requested}: ${link}`);
      if (!print) Bun.spawn(['open', link]);
      return;
    }
    await wait(250);
  }
  console.error(
    'No sign-in mail was captured. Restart `bun dev` so it picks up DEV_MAIL_CAPTURE.',
  );
  process.exit(1);
}

if (import.meta.main) await main();
