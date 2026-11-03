import { resolve } from 'node:path';
import type { HttpSession } from './http-session';

/**
 * The one real browser Round beside the driver's: Chromium holds both seats and
 * does its own reads and check-ins, and the driver measures the same boundary at
 * LiveKit. A Node 24 child, as every Playwright driver here is.
 */
export async function openBrowserSeats(input: {
  readonly origin: string;
  readonly roundId: string;
  readonly profile: 'live' | 'held';
  readonly seats: readonly {
    readonly session: HttpSession;
    readonly role: 'affirmative' | 'negative';
  }[];
}) {
  const web = resolve(import.meta.dir, '../../apps/web');
  const child = Bun.spawn(
    [
      process.env.ROOM_LAUNCH_NODE ?? 'node',
      'e2e/support/floor-control-browser.ts',
    ],
    { cwd: web, stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
  );
  child.stdin.write(
    JSON.stringify({
      origin: input.origin,
      roundId: input.roundId,
      profile: input.profile,
      seats: input.seats.map((seat) => ({
        role: seat.role,
        cookies: seat.session.cookies(),
      })),
    }),
  );
  child.stdin.end();
  const reader = child.stdout.getReader();
  let buffered = '';
  while (!buffered.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('Browser control exited before admission');
    buffered += new TextDecoder().decode(value);
  }
  const ready = JSON.parse(buffered.split('\n')[0]!) as {
    readonly identities: Record<'affirmative' | 'negative', string>;
    readonly roomName: string;
  };
  return {
    ...ready,
    close: async () => {
      child.kill('SIGTERM');
      await child.exited;
    },
  };
}
