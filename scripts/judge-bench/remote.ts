/**
 * Runs `remote-read.ts` on a deployed web machine over `fly ssh console`,
 * inside its READ ONLY transaction, and returns the one marked JSON result.
 * `mode` is the environment that selects what it reads (JB_ROUND, JB_PASSES…).
 */
const MARK = 'JUDGE_BENCH_JSON:';

export async function remoteRead(
  mode: Readonly<Record<string, string>>,
  app: string,
): Promise<unknown> {
  const script = await Bun.file('scripts/judge-bench/remote-read.ts').text();
  const encoded = Buffer.from(script).toString('base64');
  const env = Object.entries(mode)
    .map(([key, value]) => {
      if (!/^JB_[A-Z]+$/.test(key) || !/^[\w-]+$/.test(value))
        throw new Error(`unsafe remote-read setting ${key}`);
      return `${key}=${value}`;
    })
    .join(' ');
  // The machine resolves @daisy/db and drizzle-orm from packages/db; the file is removed after.
  const remote = `cd /app/packages/db && echo ${encoded} | base64 -d > .jb-read.ts && ${env} bun .jb-read.ts; status=$?; rm -f .jb-read.ts; exit $status`;
  const proc = Bun.spawn(
    ['fly', 'ssh', 'console', '-a', app, '-C', `sh -c '${remote}'`],
    { stdout: 'pipe', stderr: 'inherit' },
  );
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error('the remote read failed');
  const line = out.split('\n').find((row) => row.startsWith(MARK));
  if (!line) throw new Error('the remote read printed no result');
  return JSON.parse(line.slice(MARK.length));
}
