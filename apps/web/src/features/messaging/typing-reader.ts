import { buildChannelTopic } from '@daisy/protocol';
import { readTypingResponse } from './typing-response';
import type { ConnectionStore } from '../realtime/connection-store';
type Timers = {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
};
/** Hints and reconnect invalidate the projection; authoritative HTTP plus expiry polling supplies truth. */
export function attachTypingReader({
  channelId,
  connection,
  read,
  timers,
  publish,
}: {
  readonly channelId: string;
  readonly connection: Pick<ConnectionStore, 'subscribeTopic' | 'subscribe'>;
  readonly read: () => Promise<Response>;
  readonly timers: Timers;
  readonly publish: (typing: boolean | null) => void;
}) {
  let closed = false,
    busy = false,
    queued = false,
    generation = 0;
  let timer: unknown = null,
    interval: number | null = null;
  const cancel = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const refresh = () => {
    if (closed) return;
    generation++;
    queued = true;
    cancel();
    publish(null);
    void drain();
  };
  const accept = (
    result: Awaited<ReturnType<typeof readTypingResponse>>,
    attempt: number,
  ) => {
    if (closed || attempt !== generation) return;
    if (result) {
      interval = result.refreshAfterMs;
      publish(result.typing);
    } else publish(null);
  };
  const drain = async () => {
    if (busy || closed) return;
    busy = true;
    while (queued && !closed) {
      queued = false;
      const attempt = generation;
      accept(await readTypingResponse(channelId, read()), attempt);
    }
    busy = false;
    if (!closed && interval !== null)
      timer = timers.setTimeout(refresh, interval);
  };
  const stopTopic = connection.subscribeTopic(
    buildChannelTopic(channelId),
    (frame) => {
      if (
        frame.type === 'typing_changed' ||
        frame.type === 'resync_required' ||
        frame.type === 'subscribed' ||
        frame.type === 'event'
      )
        refresh();
    },
  );
  const stopState = connection.subscribe((state) => {
    if (state.status === 'open' || state.status === 'closed') refresh();
  });
  refresh();
  return {
    close() {
      closed = true;
      generation++;
      cancel();
      stopTopic();
      stopState();
      publish(null);
    },
  };
}
