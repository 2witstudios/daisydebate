import { systemId } from '@daisy/clock';

/** A loopback edge's certificate is self-signed per run; a rig has a real one. */
const tlsFor = (origin: string) =>
  ['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
    ? { tls: { rejectUnauthorized: false } }
    : {};
export type DriverResponse = {
  readonly status: number;
  readonly body: unknown;
  readonly serverNowMs: number | null;
};

/** One signed-in client: a cookie jar over real HTTP, with its answers counted. */
export function createHttpSession(input: {
  readonly origin: string;
  readonly refused: (operation: string, status: number) => void;
}) {
  const cookies = new Map<string, string>();
  const request = async (
    operation: string,
    path: string,
    init: {
      readonly method?: string;
      readonly json?: unknown;
      readonly form?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<DriverResponse> => {
    const response = await fetch(`${input.origin}${path}`, {
      method: init.method ?? (init.json || init.form ? 'POST' : 'GET'),
      redirect: 'manual',
      headers: {
        origin: input.origin,
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.json ? { 'content-type': 'application/json' } : {}),
        ...(init.form
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      ...(init.json ? { body: JSON.stringify(init.json) } : {}),
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
      ...tlsFor(input.origin),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair!.indexOf('=');
      cookies.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    if (response.status === 429 || response.status >= 500)
      input.refused(operation, response.status);
    const stamp = Number(response.headers.get('x-server-now-ms'));
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      serverNowMs: Number.isFinite(stamp) && stamp > 0 ? stamp : null,
    };
  };
  return { request, cookies: () => [...cookies] };
}
export type HttpSession = ReturnType<typeof createHttpSession>;
export const newCommandId = () => systemId.next();

/** Signs a new member up through the production handlers, reading the captured mail. */
export async function signUpMember(input: {
  readonly session: HttpSession;
  readonly mailCaptureUrl: string;
  readonly approve: (email: string) => Promise<void>;
}) {
  const { session, mailCaptureUrl } = input;
  const unique = systemId.next().slice(0, 16);
  const email = `floor${unique}@example.test`;
  await fetch(`${mailCaptureUrl}/reset`, { method: 'POST' });
  const asked = await session.request(
    'auth.link',
    '/api/auth/sign-in/magic-link',
    { json: { email, callbackURL: '/lobby' } },
  );
  if (asked.status !== 200) throw new Error(`Sign-in link: ${asked.status}`);
  const token = await mailedToken(mailCaptureUrl, email);
  const confirmed = await session.request('auth.confirm', '/auth/confirm', {
    form: { token, callbackURL: '/lobby' },
  });
  if (confirmed.status !== 303)
    throw new Error(`Sign-in confirm: ${confirmed.status}`);
  const aged = await session.request('account.age', '/api/account/age', {
    json: { month: 1, year: 1990, terms: true },
  });
  if (aged.status !== 200) throw new Error(`Age step: ${aged.status}`);
  const claimed = await session.request(
    'account.username',
    '/api/account/username',
    { json: { username: `floor${unique}` } },
  );
  if (claimed.status !== 201) throw new Error(`Username: ${claimed.status}`);
  await input.approve(email);
}
async function mailedToken(mailCaptureUrl: string, email: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const mails = (await (
      await fetch(`${mailCaptureUrl}/mails?to=${email}`)
    ).json()) as { readonly text: string }[];
    const link = mails.at(-1)?.text.match(/https:\/\/\S+/)?.[0];
    const token = link && new URL(link).searchParams.get('token');
    if (token) return token;
    await Bun.sleep(100);
  }
  throw new Error('No sign-in mail reached the capture');
}
