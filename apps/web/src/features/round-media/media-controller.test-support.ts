import type { RoundMediaAdmission } from '@daisy/protocol';
import type { BrowserMediaTransport } from './media-controller';

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
