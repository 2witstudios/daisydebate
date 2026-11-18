import type { SQL } from 'bun';
import { finishedOrBlockedBehind } from '@daisy/db/testing';

type Settled<T> =
  | { readonly kind: 'answer'; readonly value: T }
  | { readonly kind: 'failed'; readonly error: unknown };
const settle = async <T>(work: () => Promise<T>): Promise<Settled<T>> => {
  try {
    return { kind: 'answer', value: await work() };
  } catch (error) {
    return { kind: 'failed', error };
  }
};
/** Pin actual Round/account lock order, without a timer or a substituted operation. */
export async function interleaveRoundWriters<A, B>(input: {
  readonly owner: SQL;
  readonly observer: SQL;
  readonly roundId: string;
  readonly first: () => Promise<A>;
  readonly second: () => Promise<B>;
}) {
  const waiting = await input.owner.begin(async (tx) => {
    await tx`select id from rounds where id=${input.roundId} for no key update`;
    const [holder] = await tx`select pg_backend_pid() pid`;
    const first = settle(input.first);
    if (
      (await finishedOrBlockedBehind(
        first,
        input.observer,
        Number(holder!.pid),
        { now: Date.now },
      )) !== 'blocked'
    )
      throw new Error('First writer did not reach the actual Round lock');
    const pids = await input.observer<
      { pid: number }[]
    >`select pid from pg_stat_activity where ${Number(holder!.pid)}=any(pg_blocking_pids(pid))`;
    if (pids.length !== 1)
      throw new Error('First Round writer backend is ambiguous');
    const second = settle(input.second);
    if (
      (await finishedOrBlockedBehind(second, input.observer, pids[0]!.pid, {
        now: Date.now,
      })) !== 'blocked'
    )
      throw new Error(
        'Second writer did not reach the first writer account fence',
      );
    return { first, second };
  });
  return { first: await waiting.first, second: await waiting.second };
}
