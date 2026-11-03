import { z } from 'zod';

const required = z.string().min(1);
const targetSchema = z.object({
  FLOOR_ORIGIN: z.url(),
  FLOOR_MAIL_CAPTURE_URL: z.url(),
  FLOOR_DATABASE_URL: required,
  FLOOR_LIVEKIT_URL: z.url(),
  FLOOR_LIVEKIT_API_KEY: required,
  FLOOR_LIVEKIT_API_SECRET: required,
  /** What a seat dials, when it differs from the URL admission hands out. */
  FLOOR_LIVEKIT_SEAT_URL: z.url().optional(),
  /** Hosts of a rented rig, each named in full; loopback needs no naming. */
  FLOOR_RIG_HOSTS: z.string().default(''),
  /** Server log files to summarise, comma separated. */
  FLOOR_SERVER_LOGS: z.string().default(''),
});
const list = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** Where one run points. It comes only from configuration, never a default. */
export const readTarget = (
  env: Readonly<Record<string, string | undefined>>,
) => {
  const parsed = targetSchema.parse(env);
  return {
    origin: parsed.FLOOR_ORIGIN,
    mailCaptureUrl: parsed.FLOOR_MAIL_CAPTURE_URL,
    databaseUrl: parsed.FLOOR_DATABASE_URL,
    liveKit: {
      url: parsed.FLOOR_LIVEKIT_URL,
      apiKey: parsed.FLOOR_LIVEKIT_API_KEY,
      apiSecret: parsed.FLOOR_LIVEKIT_API_SECRET,
    },
    seatUrl: parsed.FLOOR_LIVEKIT_SEAT_URL ?? null,
    rigHosts: list(parsed.FLOOR_RIG_HOSTS),
    serverLogs: list(parsed.FLOOR_SERVER_LOGS),
  };
};
export type DriverTarget = ReturnType<typeof readTarget>;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const isProduction = (host: string) =>
  /(^|[.-])prod(uction)?([.-]|$)/.test(host) ||
  ((host === 'daisydebate.com' || host.endsWith('.daisydebate.com')) &&
    host !== 'beta.daisydebate.com');

const hostRefusal = (
  label: string,
  url: string,
  rigHosts: readonly string[],
) => {
  const host = new URL(url).hostname;
  if (isProduction(host)) return [`${label} host ${host} is production`];
  return LOOPBACK.has(host) || rigHosts.includes(host)
    ? []
    : [`${label} host ${host} is not loopback or a named rig`];
};

/**
 * Why this target must not be driven; empty means it may. Loopback or a host
 * named in full is required, and a name that says production never passes, even
 * listed. The database's own name is a second, independent fence.
 */
export const targetRefusals = (target: DriverTarget): readonly string[] => {
  const { rigHosts } = target;
  const database = new URL(target.databaseUrl).pathname.slice(1);
  return [
    ...hostRefusal('origin', target.origin, rigHosts),
    ...hostRefusal('mail capture', target.mailCaptureUrl, rigHosts),
    ...hostRefusal('livekit', target.liveKit.url, rigHosts),
    ...(target.seatUrl ? hostRefusal('seat', target.seatUrl, rigHosts) : []),
    ...hostRefusal(
      'database',
      target.databaseUrl.replace(/^postgres(ql)?:/, 'http:'),
      rigHosts,
    ),
    ...(/_(e2e|rig)$/.test(database)
      ? []
      : [`database ${database} does not end in _e2e or _rig`]),
  ];
};

const argsSchema = z.object({
  n: z.coerce.number().int().min(1),
  profile: z.enum(['live', 'held'], {
    error: '--profile must be live or held',
  }),
  deadlines: z.coerce.number().int().min(1).default(500),
  countdownMs: z.coerce.number().int().min(0).default(1_000),
  holdMs: z.coerce.number().int().min(0).default(500),
  pollMs: z.coerce.number().int().min(10).default(50),
  maxMinutes: z.coerce.number().positive().default(60),
  control: z.boolean().default(false),
  controlBoundMs: z.coerce.number().int().min(0).default(500),
});
const camel = (flag: string) =>
  flag
    .slice(2)
    .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

/** `--n 10 --profile held [--deadlines 500] [--control] ...` */
export const parseDriverArgs = (args: readonly string[]) => {
  const values: Record<string, string | boolean> = {};
  for (let at = 0; at < args.length; at += 1) {
    const flag = args[at]!;
    if (flag === '--control') values.control = true;
    else values[camel(flag)] = args[(at += 1)] ?? '';
  }
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid arguments');
  return parsed.data;
};
export type DriverArgs = ReturnType<typeof parseDriverArgs>;
