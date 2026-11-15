import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Admit less than the enclosing job budget, leaving unchanged regressions time. */
export const compileWindowSeconds = (startedAt: number, now: number) => {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt)
    throw new Error('Invalid CI job time');
  return Math.min(
    1800,
    Math.floor((startedAt + 20 * 60_000 - now) / 1000) - 6 * 60,
  );
};

export const observeNativeCompile = async () => {
  const run = z.string().regex(/^\d+$/).parse(process.env.GITHUB_RUN_ID);
  const attempt = z
    .string()
    .regex(/^\d+$/)
    .parse(process.env.GITHUB_RUN_ATTEMPT);
  const shard = z
    .string()
    .regex(/^[1-4]\/4$/)
    .parse(process.env.DAISY_INTEGRATION_SHARD);
  const response = await fetch(
    `https://api.github.com/repos/2witstudios/daisydebate/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`,
    {
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error('CI job budget unavailable');
  const jobs = z
    .object({
      jobs: z.array(
        z.object({ name: z.string(), started_at: z.string().nullable() }),
      ),
    })
    .parse(await response.json());
  const job = jobs.jobs.find(
    ({ name }) => name === `Infrastructure contracts (${shard})`,
  );
  if (!job?.started_at) throw new Error('Current CI job missing');
  const budget = compileWindowSeconds(
    Date.parse(job.started_at),
    Math.max(Date.now(), Date.parse(response.headers.get('date') ?? 'invalid')),
  );
  if (budget < 90) throw new Error('No contained compile window remains');
  const tool = (name: string) => {
    const result = Bun.spawnSync(['rustup', 'which', name], { timeout: 5000 });
    if (result.exitCode !== 0)
      throw new Error('Installed Rust toolchain unavailable');
    return z
      .string()
      .regex(/^\/[A-Za-z0-9_./+-]+$/)
      .parse(result.stdout.toString().trim());
  };
  const cargo = tool('cargo');
  const rustc = tool('rustc');
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined || uid === 0)
    throw new Error('CI user identity unavailable');
  const endBootSeconds =
    Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) + budget;
  const script = `${import.meta.dir}/native-owner-compile/watchdog.py`;
  const child = Bun.spawn(
    [
      'sudo',
      '-n',
      'python3',
      '-B',
      script,
      String(uid),
      String(gid),
      String(endBootSeconds),
      cargo,
      rustc,
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: (budget + 90) * 1000,
    },
  );
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).arrayBuffer();
  const [text, errors, exit] = await Promise.all([
    stdout,
    stderr,
    child.exited,
  ]);
  // Forward only our bounded structured observations; suppress raw Python/transport output.
  for (const line of text.split('\n').filter(Boolean)) {
    const item: unknown = JSON.parse(line);
    const event = z
      .object({ event: z.literal('native.ownerCompile'), stage: z.string() })
      .passthrough()
      .parse(item);
    process.stdout.write(JSON.stringify(event) + '\n');
  }
  process.stdout.write(
    JSON.stringify({
      event: 'native.ownerCompile.process',
      exitCode: exit,
      signal: child.signalCode,
      stderrBytes: errors.byteLength,
      suppressedStderrSha256: createHash('sha256')
        .update(new Uint8Array(errors))
        .digest('hex'),
      initialRemainingWindowSeconds: budget,
    }) + '\n',
  );
  return exit;
};
