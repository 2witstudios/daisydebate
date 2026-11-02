import type { RoundMediaAdmission } from '@daisy/protocol';
import { settle } from './browser-transport.test-support';
import {
  createMediaController,
  type BrowserMediaTransport,
} from './media-controller';

export const roundId = 'r'.repeat(24);
export const admission: RoundMediaAdmission = {
  version: 1,
  roundId,
  state: 'ready',
  grants: {
    publish: ['camera', 'microphone'],
    subscribe: true,
    hidden: false,
    capture: false,
  },
  peers: [],
  identity: 'p'.repeat(24),
  token: 'private-token',
  url: 'wss://media.invalid',
  expiresAt: '2026-10-22T09:01:00.000Z',
};

export const snapshot = {
  version: admission.version,
  roundId,
  state: admission.state,
  grants: admission.grants,
  peers: admission.peers,
};

/** A transport that does nothing unless a test overrides it. */
export const transportStub = (
  overrides: Partial<BrowserMediaTransport> = {},
): BrowserMediaTransport => ({
  connect: async () => undefined,
  apply: async () => undefined,
  stopTracks: () => undefined,
  disconnect: async () => undefined,
  ...overrides,
});

/** An abort signal that counts the listeners still attached to it. */
export const trackedSignal = () => {
  const controller = new AbortController();
  const { signal } = controller;
  let listeners = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((...args: Parameters<typeof add>) => {
    listeners++;
    add(...args);
  }) as typeof signal.addEventListener;
  signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
    listeners--;
    remove(...args);
  }) as typeof signal.removeEventListener;
  return {
    signal,
    abort: () => controller.abort(),
    listening: () => listeners,
  };
};

type ControllerInput = Parameters<typeof createMediaController>[0];

/** A controller at Round view 3 that admits at once; tests supply what differs. */
export const readController = (
  input: Pick<ControllerInput['api'], 'reconcile'> &
    Partial<Pick<ControllerInput['api'], 'admit'>> &
    Partial<Omit<ControllerInput, 'api' | 'roundId'>>,
) => {
  const { reconcile, admit, ...rest } = input;
  return createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    transport: () => transportStub(),
    changed: () => undefined,
    ...rest,
    api: { admit: admit ?? (async () => admission), reconcile },
  });
};

/** A newer accepted Round view, as the caller reports it. */
export const viewAt = (value: number) =>
  ({ kind: 'view', roundViewVersion: value }) as const;

/** Joins, forgets the join's receipts, and starts one wake that is now in flight. */
export const wakeAfterJoin = async (
  controller: ReturnType<typeof readController>,
  receipts: unknown[],
) => {
  await controller.join();
  receipts.length = 0;
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  // In an object: an async function returning it directly would wait for it.
  return { pending };
};

/** A live controller whose second read, a wake, is held until the test answers. */
export const heldSecondRead = async () => {
  const held = Promise.withResolvers<unknown>();
  let reads = 0;
  let stops = 0;
  const controller = readController({
    admit: async () => admission,
    reconcile: async () => (++reads === 2 ? held.promise : snapshot),
    transport: () => transportStub({ stopTracks: () => void stops++ }),
  });
  const { pending } = await wakeAfterJoin(controller, []);
  return {
    held,
    controller,
    pending,
    reads: () => reads,
    stops: () => stops,
  };
};
