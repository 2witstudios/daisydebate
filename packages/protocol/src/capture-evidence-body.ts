import { utf8Bytes } from './observation';
import { z } from 'zod';
import { idSchema } from './primitives';
import { frameClockEvidenceSchema } from './frame-clock-evidence';
import { necessaryEvidencePolicy } from './necessary-evidence';

const instant = () =>
  z.number().int().min(-8640000000000000).max(8640000000000000);
const iso = z.iso.datetime({ precision: 3 });
/** Exactly 160 signed little-endian samples, canonical base64 including its final padding bits. */
const pcmS16le = z.string().regex(/^[A-Za-z0-9+/]{426}[AEIMQUYcgkosw048]=$/);
const captureEvidenceBodySchema = z
  .strictObject({
    version: z.literal(1),
    evidenceId: idSchema,
    roundId: idSchema,
    sessionId: idSchema,
    workerId: idSchema,
    epoch: z.number().int().min(1).max(2147483647),
    segmentId: idSchema,
    roundParticipantId: idSchema,
    trackId: z.string().min(1).max(128),
    intervalId: idSchema,
    historyVersion: z.number().int().min(0).max(2147483647),
    historyReadAt: iso,
    segmentStartedAtMs: instant(),
    startOffsetMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    durationMs: z.number().int().min(10).max(400),
    before: iso,
    after: iso,
    frames: z
      .array(z.strictObject({ pcmS16le, clock: frameClockEvidenceSchema }))
      .min(1)
      .max(40),
  })
  .refine((body) => {
    const frames = body.frames;
    const first = frames[0]!,
      last = frames.at(-1)!;
    const anchor = JSON.stringify(first.clock.anchor);
    return (
      first.clock.window.nominalStartMs ===
        body.segmentStartedAtMs + body.startOffsetMs &&
      body.durationMs ===
        last.clock.window.nominalStartMs -
          first.clock.window.nominalStartMs +
          10 &&
      Date.parse(body.before) ===
        Math.floor(
          Math.min(...frames.map((frame) => frame.clock.window.beforeMs)),
        ) &&
      Date.parse(body.after) ===
        Math.ceil(
          Math.max(...frames.map((frame) => frame.clock.window.afterMs)),
        ) &&
      Date.parse(body.after) <= Date.parse(body.historyReadAt) &&
      frames.every(
        (frame, index) =>
          JSON.stringify(frame.clock.anchor) === anchor &&
          (index === 0 ||
            (frame.clock.observation.sequence ===
              frames[index - 1]!.clock.observation.sequence + 1 &&
              frame.clock.previous?.sequence ===
                frames[index - 1]!.clock.observation.sequence &&
              frame.clock.previous.nominalStartMs ===
                frames[index - 1]!.clock.window.nominalStartMs &&
              frame.clock.window.nominalStartMs ===
                frames[index - 1]!.clock.window.nominalStartMs + 10)),
      )
    );
  });
export type CaptureEvidenceBody = z.infer<typeof captureEvidenceBodySchema>;
/** Canonical bytes cover every original field. This encoding is not an admission, hearing or coverage fact. */
export function canonicalCaptureEvidenceBody(input: unknown):
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'encoded';
      readonly body: CaptureEvidenceBody;
      readonly json: string;
      readonly byteLength: number;
    } {
  const parsed = captureEvidenceBodySchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const json = JSON.stringify(parsed.data);
  const byteLength = utf8Bytes(json);
  if (byteLength > necessaryEvidencePolicy.maxPayloadBytes)
    return { kind: 'invalid' };
  return { kind: 'encoded', body: parsed.data, json, byteLength };
}
