import { createAppError } from '@daisy/errors';

export type AppendOutcome<T> =
  { readonly value: T } | { readonly error: unknown };
type Pending<C, R> = {
  readonly command: C;
  readonly actor: string;
  readonly bytes: number;
  readonly at: number;
  cancelExpiry?: () => void;
  readonly resolve: (value: R) => void;
  readonly reject: (error: unknown) => void;
};
/** Expendable bounded work. A result is delivered only after execute has committed/settled. */
export function createAppendCollector<C, R>({
  execute,
  now = () => performance.now(),
  schedule = (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
}: {
  readonly execute: (
    channel: string,
    commands: readonly C[],
  ) => Promise<readonly AppendOutcome<R>[]>;
  readonly now?: () => number;
  readonly schedule?: (run: () => void, ms: number) => () => void;
}) {
  type Channel = {
    pending: Pending<C, R>[];
    count: number;
    running: boolean;
    ready: boolean;
    cancel?: () => void;
  };
  const channels = new Map<string, Channel>();
  const actors = new Map<string, number>();
  let count = 0,
    bytes = 0;
  const unavailable = () =>
    createAppError('INFRASTRUCTURE', 'Messaging capacity unavailable');
  const settle = (
    channel: Channel,
    entry: Pending<C, R>,
    outcome: AppendOutcome<R>,
  ) => {
    entry.cancelExpiry?.();
    const actorCount = actors.get(entry.actor)! - 1;
    if (actorCount) actors.set(entry.actor, actorCount);
    else actors.delete(entry.actor);
    count--;
    bytes -= entry.bytes;
    channel.count--;
    if ('error' in outcome) entry.reject(outcome.error);
    else entry.resolve(outcome.value);
  };
  const takeActor = (
    actor: string,
    channel: Channel,
    room: number,
  ): Pending<C, R> | 'full' | null => {
    const index = channel.pending.findIndex((entry) => entry.actor === actor);
    if (index < 0) return null;
    const entry = channel.pending[index]!;
    if (now() - entry.at >= 3000) {
      channel.pending.splice(index, 1);
      settle(channel, entry, { error: unavailable() });
      return null;
    }
    if (entry.bytes > room) return 'full';
    channel.pending.splice(index, 1);
    entry.cancelExpiry?.();
    return entry;
  };
  const collectBatch = (channel: Channel) => {
    const batch: Pending<C, R>[] = [];
    let size = 0;
    const actors = [...new Set(channel.pending.map((entry) => entry.actor))];
    while (batch.length < 32 && channel.pending.length) {
      const before = channel.pending.length;
      for (const actor of actors) {
        if (batch.length === 32) return batch;
        const entry = takeActor(actor, channel, 128 * 1024 - size);
        if (entry === 'full') return batch;
        if (!entry) continue;
        batch.push(entry);
        size += entry.bytes;
      }
      if (before === channel.pending.length) break;
    }
    return batch;
  };
  const flush = async (id: string, channel: Channel) => {
    if (channel.running || !channel.ready) return;
    channel.cancel?.();
    delete channel.cancel;
    channel.ready = false;
    const batch = collectBatch(channel);
    channel.running = true;
    try {
      if (batch.length) {
        const outcomes = await execute(
          id,
          batch.map((entry) => entry.command),
        );
        if (outcomes.length !== batch.length)
          throw new Error('Append outcome count mismatch');
        batch.forEach((entry, index) =>
          settle(channel, entry, outcomes[index]!),
        );
      }
    } catch (error) {
      batch.forEach((entry) => settle(channel, entry, { error }));
    } finally {
      channel.running = false;
      if (channel.pending.length) {
        channel.ready = true;
        void flush(id, channel);
      } else channels.delete(id);
    }
  };
  const requireBytes = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 1 || size > 128 * 1024)
      throw createAppError('VALIDATION');
  };
  const admission = (
    channelId: string,
    actor: string,
    size: number,
  ): Channel => {
    requireBytes(size);
    let channel = channels.get(channelId);
    if (
      (actors.get(actor) ?? 0) >= 128 ||
      count >= 2048 ||
      bytes + size > 16 * 1024 * 1024 ||
      (channel?.count ?? 0) >= 1024
    )
      throw unavailable();
    if (!channel) {
      channel = { pending: [], count: 0, running: false, ready: false };
      channels.set(channelId, channel);
    }
    return channel;
  };
  return {
    append(
      channelId: string,
      actor: string,
      command: C,
      size: number,
    ): Promise<R> {
      let channel: Channel;
      try {
        channel = admission(channelId, actor, size);
      } catch (error) {
        return Promise.reject(error);
      }
      const queue = channel;
      actors.set(actor, (actors.get(actor) ?? 0) + 1);
      count++;
      bytes += size;
      queue.count++;
      const result = new Promise<R>((resolve, reject) => {
        const entry: Pending<C, R> = {
          command,
          actor,
          bytes: size,
          at: now(),
          resolve,
          reject,
        };
        queue.pending.push(entry);
        entry.cancelExpiry = schedule(() => {
          const index = queue.pending.indexOf(entry);
          if (index < 0) return;
          queue.pending.splice(index, 1);
          settle(queue, entry, { error: unavailable() });
          if (!queue.pending.length && !queue.running) {
            queue.cancel?.();
            channels.delete(channelId);
          }
        }, 3000);
      });
      const pendingBytes = queue.pending.reduce(
        (total, entry) => total + entry.bytes,
        0,
      );
      if (queue.pending.length >= 32 || pendingBytes >= 128 * 1024) {
        queue.ready = true;
        void flush(channelId, queue);
      } else if (!queue.cancel)
        queue.cancel = schedule(() => {
          delete queue.cancel;
          queue.ready = true;
          void flush(channelId, queue);
        }, 5);
      return result;
    },
  };
}
