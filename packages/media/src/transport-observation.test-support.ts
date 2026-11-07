import { TransportObservation } from './transport-observation/transport-observation';
const row = (packets = 10n, identity = 'original', samples = 20000n) => ({
  stats: {
    case: 'inboundRtp',
    value: {
      stream: { kind: 'audio', ssrc: 42 },
      received: { packetsReceived: packets, packetsLost: 0n },
      inbound: {
        trackIdentifier: identity,
        totalSamplesReceived: samples,
        concealedSamples: 10000n,
      },
    },
  },
});
const setup = (replies: unknown[]) => {
  let now = 1000,
    calls = 0;
  const observer = TransportObservation.create({
    binding: {
      incarnation: 'c'.repeat(24),
      trackId: 'TR_original',
      generation: 1,
    },
    nowMs: () => now,
    readStats: async () => {
      calls++;
      now += 5;
      return replies.shift();
    },
  });
  return {
    observer,
    at: (value: number) => {
      now = value;
    },
    calls: () => calls,
  };
};
export const TransportFixture = { row, setup };
