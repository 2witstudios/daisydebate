#!/usr/bin/env bun
/**
 * AUTH-7.7's alert evaluation point. Staging scales to zero
 * (`fly.toml`'s `min_machines_running = 0`), so nothing running inside the
 * app can notice its own multi-minute or multi-hour silence, or alert while
 * it is asleep or crash-looping. This script runs outside the app instead
 * (the scheduled `auth-alerts.yml` GitHub Actions workflow, every 5
 * minutes) and:
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
 *   bun scripts/auth-alert-probe.ts --origin https://daisy.example.com \
 *     --token <OPS_PROBE_TOKEN> [--run-url <workflow run URL>]
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
 */
export function evaluateOriginProbe(input: {
  readonly status: number;
  readonly headers: ReadonlyMap<string, string>;
}): OriginProbeResult {
  const issues: string[] = [];
  if (input.status !== 200)
    issues.push(`readiness answered ${input.status}, not 200`);
  for (const [name, expected] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
    const actual = input.headers.get(name);
    if (actual !== expected)
      issues.push(`${name}: expected "${expected}", got ${actual ?? 'none'}`);
  }
  return { ok: issues.length === 0, issues };
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

const flag = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

async function readHeaders(response: Response): Promise<Map<string, string>> {
  const headers = new Map<string, string>();
  for (const [name, value] of response.headers) headers.set(name, value);
  return headers;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const origin = flag(args, 'origin');
  const token = flag(args, 'token');
  const runUrl = flag(args, 'run-url');
  if (!origin || !token) {
    process.stderr.write(
      'usage: bun scripts/auth-alert-probe.ts --origin <https url> --token <OPS_PROBE_TOKEN> [--run-url <url>]\n',
    );
    process.exit(2);
    return;
  }

  const readyResponse = await fetch(new URL('/api/health/ready', origin), {
    redirect: 'error',
  });
  const originProbe = evaluateOriginProbe({
    status: readyResponse.status,
    headers: await readHeaders(readyResponse),
  });

  const alertsResponse = await fetch(new URL('/api/ops/alerts', origin), {
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
  });
  if (!alertsResponse.ok)
    throw new Error(
      `/api/ops/alerts responded ${alertsResponse.status}; cannot evaluate alert conditions`,
    );
  const { conditions } = (await alertsResponse.json()) as {
    conditions: AlertCondition[];
  };

  if (conditions.length === 0 && originProbe.ok) {
    console.log('AUTH-7.7 probe: healthy, nothing to report');
    return;
  }

  const message = composeAlertMessage({
    conditions,
    originIssues: originProbe.issues,
    runUrl,
  });
  console.log(message);
  const result = Bun.spawnSync(
    ['bun', 'scripts/notify-drive.ts', 'incidents', '--message', message],
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
