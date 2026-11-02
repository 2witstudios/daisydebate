import { createLiveKitRoom } from './adapters/livekit-room';
import { settle, stubSdk } from './adapters/livekit-room.test-support';
import { admission, roundId } from './media-fixtures.test-support';
import { createMediaRuntime } from './media-runtime';
import { initialMediaState, type Source } from './model/media-state';
import { answerWith, testPolicy } from './model/media-state.test-support';

type SdkOptions = NonNullable<Parameters<typeof stubSdk>[0]>;

/**
 * The real runtime, model and adapter, with only the SDK, requests and clock stubbed.
 * `advance` moves the clock and fires what comes due, in order.
 */
export const sdkWorld = async (input: {
  readonly replies?: (read: number) => unknown;
  readonly admit?: () => Promise<unknown>;
  readonly sdk?: SdkOptions;
  readonly openRoomThrows?: () => boolean;
  readonly forgetFails?: boolean;
  readonly checkedCamera?: string;
  readonly join?: boolean;
}) => {
  const stub = stubSdk({ settles: true, ...input.sdk });
  let nowMs = 0;
  let reads = 0;
  let admissions = 0;
  let rooms = 0;
  let refreshes = 0;
  const pending = new Set<{
    readonly atMs: number;
    readonly fire: () => void;
  }>();
  const applied: string[] = [];
  const receipts: string[] = [];
  const runtime = createMediaRuntime({
    roundId,
    initial: initialMediaState({ roundViewVersion: 1, microphoneMuted: false }),
    policy: testPolicy,
    now: () => nowMs,
    at: (ms, fire) => {
      const timer = { atMs: nowMs + ms, fire };
      pending.add(timer);
      return () => void pending.delete(timer);
    },
    api: {
      admit: async () => {
        admissions++;
        return input.admit ? input.admit() : admission;
      },
      reconcile: async () => (input.replies ?? (() => answerWith([])))(++reads),
    },
    openRoom: (hooks) => {
      if (input.openRoomThrows?.()) throw new Error('Room cannot open');
      rooms++;
      return createLiveKitRoom(
        {
          ...hooks,
          checkedDevices: () => ({
            state: 'available',
            choices: input.checkedCamera ? { camera: input.checkedCamera } : {},
          }),
        },
        stub.sdk,
      );
    },
    refreshView: () => void refreshes++,
    mute: { remember: () => undefined, forget: () => undefined },
    devices: {
      forget: () => !input.forgetFails,
      clear: () => undefined,
    },
  });
  let shown: unknown = null;
  let watching = false;
  runtime.subscribe(() => {
    const { link } = runtime.state();
    if (link.phase !== 'live') return;
    const grants = link.grants.join('+');
    if (link.establishment.stage === 'established' && applied.length === 0)
      applied.push(grants);
    if (applied.length > 0 && grants !== applied.at(-1)) applied.push(grants);
    if (link.establishment.stage !== 'established') return;
    const { media } = link.establishment;
    if (media !== shown) {
      if (watching) receipts.push(media.grants.publish.join('+'));
      shown = media;
    }
  });
  if (input.join !== false) {
    runtime.dispatch({ type: 'tab-changed', owns: true });
    await settle();
  }
  watching = true;
  return {
    stub,
    runtime,
    applied,
    receipts,
    send: async (
      read:
        | { readonly kind: 'wake' }
        | { readonly kind: 'view'; readonly roundViewVersion: number },
    ) => {
      runtime.dispatch({ type: 'read-requested', read });
      await settle();
    },
    advance: async (ms: number) => {
      const until = nowMs + ms;
      for (;;) {
        const due = [...pending]
          .filter((timer) => timer.atMs <= until)
          .sort((a, b) => a.atMs - b.atMs)[0];
        if (!due) break;
        nowMs = due.atMs;
        pending.delete(due);
        due.fire();
        await settle();
      }
      nowMs = until;
    },
    reads: () => reads,
    admissions: () => admissions,
    rooms: () => rooms,
    refreshes: () => refreshes,
    timers: () => pending.size,
    stop: () => runtime.dispatch({ type: 'page-left' }),
  };
};

export const publishing = (...sources: readonly Source[]) =>
  answerWith(sources);
