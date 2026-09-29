#!/usr/bin/env bun
/**
 * AUTH-7.7's alert evaluation point. Staging scales to zero
 * (`fly.toml`'s `min_machines_running = 0`), so nothing running inside the
 * app can notice its own multi-minute or multi-hour silence, or alert while
 * it is asleep or crash-looping. This script runs outside the app instead
 * (the scheduled `auth-alerts.yml` GitHub Actions workflow — configured for
 * every 5 minutes, though GitHub's schedule trigger does not actually run
 * that often in production; the owner accepted this best-effort cadence
 * for staging rather than build a new scheduler, see ADR 0046/DEC-33) and:
 *
 *   1. probes the public origin's readiness endpoint — one non-mutating
 *      GET, proving routing (a 200 from the expected host), TLS (the fetch
 *      completing at all against an `https://` URL: an invalid or expired
 *      certificate throws before a status ever comes back) and the
 *      security-header contract `next.config.ts` sets on every response;
 *   2. reads the already-evaluated conditions from the bearer-token gated
 *      `/api/ops/alerts` (`evaluateAlerts` in
 *      `apps/web/src/server/alert-state.ts` runs server-side, so this
 *      script never reimplements a threshold — there is exactly one place
 *      each one lives);
 *   3. posts whatever fired to the drive's Incidents channel via the
 *      existing `scripts/notify-drive.ts incidents --message`.
 *
 *   OPS_PROBE_TOKEN=<token> bun scripts/auth-alert-probe.ts \
 *     --origin https://daisy.example.com [--run-url <workflow run URL>]
 */
import type { AlertCondition } from '../apps/web/src/server/alert-state';

/** The fixed header contract `apps/web/next.config.ts` sets for every response. */
export const REQUIRED_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export type OriginProbeResult = {
  readonly ok: boolean;
  readonly issues: readonly string[];
};

/**
 * Pure: given the readiness response's already-read status and headers,
 * proves routing (an expected 200) and the security-header contract. TLS
 * itself is proven by the caller's `fetch` completing at all against an
 * `https://` URL — an invalid certificate never reaches this function.
 * Headers are checked only on a 200. Any other status is one issue, not one
 * per missing header (ISSUE-196): with the app's headers it is the app
 * reporting itself not ready (ISSUE-203); without them it most likely came
 * from the edge proxy or start-up gate rather than Next.
 */
export function evaluateOriginProbe(input: {
  readonly status: number;
  readonly headers: ReadonlyMap<string, string>;
}): OriginProbeResult {
  if (input.status !== 200) {
    const fromApp = Object.keys(REQUIRED_SECURITY_HEADERS).some((name) =>
      input.headers.has(name),
    );
    const cause = fromApp
      ? 'the app reported not ready (dependency down or draining)'
      : 'the response likely did not come from the app (cold start, start-up gate, or app down)';
    return {
      ok: false,
      issues: [`readiness answered ${input.status}, not 200; ${cause}`],
    };
  }
  const issues: string[] = [];
  for (const [name, expected] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
    const actual = input.headers.get(name);
    if (actual !== expected)
      issues.push(`${name}: expected "${expected}", got ${actual ?? 'none'}`);
  }
  return { ok: issues.length === 0, issues };
}

async function readHeaders(response: Response): Promise<Map<string, string>> {
  const headers = new Map<string, string>();
  for (const [name, value] of response.headers) headers.set(name, value);
  return headers;
}

/**
 * Fetches `/api/health/ready` and evaluates it. Never throws: an origin
 * that cannot be reached at all (DNS failure, TLS failure, connection
 * refused) is itself an origin-probe issue, modeled without ever
 * constructing a placeholder `Response` — `Response` refuses a status
 * outside 101/200-599 (`new Response(null, { status: 0 })` throws
 * `RangeError`), which previously made an unreachable origin crash `main`
 * before it could post anything (ISSUE-156).
 */
export async function fetchOriginProbe(
  origin: string,
): Promise<OriginProbeResult> {
  try {
    const response = await fetch(new URL('/api/health/ready', origin), {
      redirect: 'error',
    });
    return evaluateOriginProbe({
      status: response.status,
      headers: await readHeaders(response),
    });
  } catch (error) {
    return {
      ok: false,
      issues: [`/api/health/ready request failed: ${(error as Error).message}`],
    };
  }
}

/** Pure: the Incidents message for whatever fired, naming each condition's own runbook. */
export function composeAlertMessage(input: {
  readonly conditions: readonly AlertCondition[];
  readonly originIssues: readonly string[];
  readonly runUrl?: string;
}): string {
  const lines = ['🔴 AUTH-7.7 alert probe'];
  for (const condition of input.conditions)
    lines.push(
      `- ${condition.id}: ${condition.summary} (${condition.runbook})`,
    );
  for (const issue of input.originIssues)
    lines.push(`- origin_probe: ${issue}`);
  if (input.runUrl) lines.push(input.runUrl);
  return lines.join('\n');
}

export type AlertConditionsResult =
  | { readonly ok: true; readonly conditions: readonly AlertCondition[] }
  | { readonly ok: false; readonly error: string };

/**
 * Fetches the already-evaluated conditions from `/api/ops/alerts`. Never
 * throws: a non-2xx response, a body without a `conditions` array, or a
 * fetch failure (a Redis outage most often surfaces as the latter, since
 * `/api/ops/alerts` itself depends on Redis to answer at all) comes back as
 * `{ ok: false, error }` so `main` can still post to Incidents instead of
 * dying before it posts anything.
 */
export async function fetchAlertConditions(
  origin: string,
  token: string,
): Promise<AlertConditionsResult> {
  try {
    const response = await fetch(new URL('/api/ops/alerts', origin), {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
    });
    if (!response.ok)
      return {
        ok: false,
        error: `/api/ops/alerts responded ${response.status}`,
      };
    const { conditions } = (await response.json()) as {
      conditions?: unknown;
    };
    if (!Array.isArray(conditions))
      return {
        ok: false,
        error: '/api/ops/alerts responded without a conditions array',
      };
    return { ok: true, conditions: conditions as AlertCondition[] };
  } catch (error) {
    return {
      ok: false,
      error: `/api/ops/alerts request failed: ${(error as Error).message}`,
    };
  }
}

export type ProbeOutcome =
  | { readonly healthy: true; readonly message: null }
  | { readonly healthy: false; readonly message: string };

/**
 * Pure: decides whether the probe run is healthy and, if not, the message
 * to post. An unreachable `/api/ops/alerts` (Redis outage, deploy fault, or
 * any other failure) is itself treated as an alert-worthy condition, not a
 * reason to skip posting — this is what lets a full Redis outage still
 * reach Incidents (AUTH-7.7-AC2/ISSUE-156).
 */
export function decideProbeOutcome(input: {
  readonly originProbe: OriginProbeResult;
  readonly alertConditions: AlertConditionsResult;
  readonly runUrl?: string;
}): ProbeOutcome {
  if (!input.alertConditions.ok)
    return {
      healthy: false,
      message: composeAlertMessage({
        conditions: [],
        originIssues: [
          ...input.originProbe.issues,
          `alert conditions unavailable: ${input.alertConditions.error}`,
        ],
        runUrl: input.runUrl,
      }),
    };
  if (input.alertConditions.conditions.length === 0 && input.originProbe.ok)
    return { healthy: true, message: null };
  return {
    healthy: false,
    message: composeAlertMessage({
      conditions: input.alertConditions.conditions,
      originIssues: input.originProbe.issues,
      runUrl: input.runUrl,
    }),
  };
}

const flag = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

/**
 * Pure: the bearer token comes only from the environment — this takes no
 * `args` parameter at all, so a `--token` on the command line (the shape
 * AUTH-7.11 removed everywhere else) has no way to reach it, even if one
 * were still passed.
 */
export const resolveProbeToken = (
  env: Readonly<Record<string, string | undefined>>,
): string | undefined => env.OPS_PROBE_TOKEN;

export type ProbeConfig = {
  readonly origin: string;
  readonly token: string;
  readonly runUrl: string | undefined;
};

/**
 * Pure: the full set of inputs `main` needs, or `undefined` when required
 * inputs are missing — refusal, not just token resolution, is what a
 * regression reintroducing a `--token` fallback must be caught changing.
 * `args` here can carry any flag, including a stray `--token`; only
 * `resolveProbeToken`'s environment lookup can ever supply the token.
 */
export function resolveProbeConfig(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ProbeConfig | undefined {
  const origin = flag(args, 'origin');
  const token = resolveProbeToken(env);
  const runUrl = flag(args, 'run-url');
  return origin && token ? { origin, token, runUrl } : undefined;
}

async function main(): Promise<void> {
  const config = resolveProbeConfig(process.argv.slice(2), process.env);
  if (!config) {
    process.stderr.write(
      'usage: OPS_PROBE_TOKEN=<token> bun scripts/auth-alert-probe.ts --origin <https url> [--run-url <url>]\n',
    );
    process.exit(2);
    return;
  }
  const { origin, token, runUrl } = config;

  const originProbe = await fetchOriginProbe(origin);
  const alertConditions = await fetchAlertConditions(origin, token);
  const outcome = decideProbeOutcome({ originProbe, alertConditions, runUrl });

  if (outcome.healthy) {
    console.log('AUTH-7.7 probe: healthy, nothing to report');
    return;
  }

  console.log(outcome.message);
  const result = Bun.spawnSync(
    [
      'bun',
      'scripts/notify-drive.ts',
      'incidents',
      '--message',
      outcome.message,
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if (result.exitCode !== 0)
    throw new Error('notify-drive failed to post the alert');
}

if (import.meta.main) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
