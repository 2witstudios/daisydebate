import type { RoundMediaAdmission } from '@daisy/protocol';

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

export const transportStub = () => ({
  connect: async () => undefined,
  apply: async () => undefined,
  stopTracks: () => undefined,
  disconnect: async () => undefined,
});
