import {
  canonicalCaptureEvidenceBody,
  captureStateReply,
  idSchema,
  type CaptureEvidenceBody,
} from '@daisy/protocol';
import { verifyFrameClockEvidence } from '@daisy/media/observation';
import { contained, type CaptureState } from '../capture-history';
import type { StagedFrame } from '../capture-staging';

const MAX_FRAMES = 25;
type Group = { readonly intervalId: string; readonly frames: StagedFrame[] };
const refused = () => ({ kind: 'refused' as const });
/** The original signed samples, explicitly little-endian. No energy/speech heuristic runs here. */
function pcm(frame: StagedFrame) {
  const bytes = Buffer.alloc(320);
  for (let index = 0; index < 160; index++)
    bytes.writeInt16LE(frame.frame.pcm[index]!, index * 2);
  return bytes.toString('base64');
}
function frameValid(frame: StagedFrame, state: CaptureState) {
  const original = frame.clockEvidence;
  return (
    state.segment?.id === frame.segmentId &&
    state.participants.some(
      (seat) =>
        seat.roundParticipantId === frame.seat && seat.identity !== null,
    ) &&
    frame.frame.pcm instanceof Int16Array &&
    frame.frame.pcm.length === 160 &&
    verifyFrameClockEvidence(original) &&
    frame.frame.nominalStartMs === original.window.nominalStartMs &&
    frame.frame.beforeMs === Math.floor(original.window.beforeMs) &&
    frame.frame.afterMs === Math.ceil(original.window.afterMs) &&
    frame.frame.afterMs <= Date.parse(state.serverNow) &&
    contained(state, frame.seat, frame.frame)
  );
}
/** Pure preparation only: no source release, durable receipt, coverage, silence or peer-hearing claim. */
export function prepare(input: {
  readonly state: CaptureState;
  readonly workerId: string;
  readonly epoch: number;
  readonly frames: readonly StagedFrame[];
  readonly evidenceIds: readonly string[];
}):
  | {
      readonly kind: 'prepared';
      readonly bodies: readonly CaptureEvidenceBody[];
    }
  | { readonly kind: 'refused' } {
  const parsed = captureStateReply.safeParse(input.state);
  if (
    !parsed.success ||
    !idSchema.safeParse(input.workerId).success ||
    !Number.isInteger(input.epoch) ||
    input.epoch < 1 ||
    input.epoch > 2147483647
  )
    return refused();
  const state = parsed.data;
  if (
    !state.segment ||
    !input.frames.every((frame) => frameValid(frame, state))
  )
    return refused();
  const groups: Group[] = [];
  const current = new Map<string, Group>();
  for (const frame of input.frames) {
    const interval = state.intervals.find(
      (grant) =>
        grant.roundParticipantId === frame.seat &&
        Date.parse(grant.startedAt) <= frame.frame.beforeMs &&
        (grant.endedAt === null ||
          frame.frame.afterMs < Date.parse(grant.endedAt)),
    );
    if (!interval) return refused();
    const key = JSON.stringify([
      frame.seat,
      frame.segmentId,
      frame.frame.trackId,
      interval.id,
      frame.clockEvidence.anchor,
    ]);
    let group = current.get(key);
    const last = group?.frames.at(-1);
    if (
      !group ||
      group.frames.length === MAX_FRAMES ||
      (last &&
        (frame.clockEvidence.observation.sequence !==
          last.clockEvidence.observation.sequence + 1 ||
          frame.frame.nominalStartMs !== last.frame.nominalStartMs + 10))
    ) {
      group = { intervalId: interval.id, frames: [] };
      groups.push(group);
      current.set(key, group);
    }
    group.frames.push(frame);
  }
  const bodies: CaptureEvidenceBody[] = [];
  const ids = new Set<string>();
  for (const [index, group] of groups.entries()) {
    const evidenceId = input.evidenceIds[index];
    if (!idSchema.safeParse(evidenceId).success || ids.has(evidenceId!))
      return refused();
    ids.add(evidenceId!);
    const first = group.frames[0]!,
      last = group.frames.at(-1)!;
    const encoded = canonicalCaptureEvidenceBody({
      version: 1,
      evidenceId,
      roundId: state.roundId,
      sessionId: state.sessionId,
      workerId: input.workerId,
      epoch: input.epoch,
      segmentId: state.segment.id,
      roundParticipantId: first.seat,
      trackId: first.frame.trackId,
      intervalId: group.intervalId,
      historyVersion: state.version,
      historyReadAt: state.serverNow,
      segmentStartedAtMs: Date.parse(state.segment.startedAt),
      startOffsetMs:
        first.frame.nominalStartMs - Date.parse(state.segment.startedAt),
      durationMs: last.frame.nominalStartMs - first.frame.nominalStartMs + 10,
      before: new Date(
        Math.min(...group.frames.map((f) => f.frame.beforeMs)),
      ).toISOString(),
      after: new Date(
        Math.max(...group.frames.map((f) => f.frame.afterMs)),
      ).toISOString(),
      frames: group.frames.map((frame) => ({
        pcmS16le: pcm(frame),
        clock: frame.clockEvidence,
      })),
    });
    if (encoded.kind !== 'encoded') return refused();
    bodies.push(encoded.body);
  }
  return { kind: 'prepared', bodies };
}
