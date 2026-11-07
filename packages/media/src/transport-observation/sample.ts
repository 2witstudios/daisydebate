import { z } from 'zod';
const counter = z
  .bigint()
  .min(0n)
  .max((1n << 64n) - 1n);
const envelope = z.object({
  stats: z.object({ case: z.string(), value: z.unknown() }),
});
const audio = z.object({
  stream: z.object({
    kind: z.literal('audio'),
    ssrc: z.number().int().min(0).max(0xffffffff),
  }),
  received: z.object({ packetsReceived: counter, packetsLost: counter }),
  inbound: z.object({
    trackIdentifier: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    totalSamplesReceived: counter,
    concealedSamples: counter,
  }),
});
/** Bound before traversal; ambiguity and absence are unknown, never fabricated zero counters. */
export function sample(input: unknown) {
  if (!Array.isArray(input) || input.length > 512)
    return { kind: 'unknown', reason: 'malformed' } as const;
  let found: unknown = null,
    count = 0;
  for (const row of input) {
    const parsed = envelope.safeParse(row);
    if (!parsed.success)
      return { kind: 'unknown', reason: 'malformed' } as const;
    if (parsed.data.stats.case !== 'inboundRtp') continue;
    if (++count > 1) return { kind: 'unknown', reason: 'ambiguous' } as const;
    found = parsed.data.stats.value;
  }
  if (!count) return { kind: 'unknown', reason: 'missing' } as const;
  const parsed = audio.safeParse(found);
  if (!parsed.success) return { kind: 'unknown', reason: 'malformed' } as const;
  const { stream, received, inbound } = parsed.data;
  return {
    kind: 'sample',
    identity: `${stream.ssrc}:${inbound.trackIdentifier}`,
    counters: {
      packetsReceived: received.packetsReceived.toString(),
      packetsLost: received.packetsLost.toString(),
      totalSamplesReceived: inbound.totalSamplesReceived.toString(),
      concealedSamples: inbound.concealedSamples.toString(),
    },
  } as const;
}
