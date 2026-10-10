import { resolve } from 'node:path';
import { z } from 'zod';
const admitted = z.strictObject({
  version: z.literal(1),
  admitted: z.literal(true),
  target: z.strictObject({
    database: z.string(),
    role: z.literal('daisy_e2e'),
    hostname: z.string(),
    port: z.string().regex(/^[1-9][0-9]{0,4}$/),
  }),
});
/** Invoke the existing read-only root CLI; never import root tooling into web. */
export async function admitLaunchCheckout(
  checkout: string,
  expectedDatabase: string,
) {
  const child = Bun.spawn(
    ['bun', resolve(checkout, 'scripts/room-account-admission.ts')],
    {
      cwd: checkout,
      env: process.env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    },
  );
  child.stdin.write(
    JSON.stringify({ version: 1, operation: 'admit-room-account-cleanup' }),
  );
  child.stdin.end();
  const [stdout, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0 || stdout.length > 1024)
    throw new Error('Launch checkout admission refused');
  try {
    const value = admitted.parse(JSON.parse(stdout));
    if (value.target.database !== expectedDatabase) throw new Error('target');
  } catch {
    throw new Error('Launch checkout admission refused');
  }
}
