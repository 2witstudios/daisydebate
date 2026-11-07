import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { captureRule } from '@daisy/debate-engine';
import { createFrameClock } from '@daisy/media/observation';
import {
  canonicalCaptureEvidenceBody,
  CAPTURE_STT_LAG_MS,
  buildRoundTopic,
} from '@daisy/protocol';
import { withRoomRuntime } from './room-runtime.test-support';
import {
  initializeLocalEvidenceAuthority,
  openLocalEvidenceAuthority,
} from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';

type RoomFixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
async function prepare(f: RoomFixture, maxOutstandingIntents: number) {
  const assembled = await f.assemble();
  const launched = await f.command(f.host, assembled, { type: 'start-round' });
  const roundId = launched.view.roundRef!.id;
  const [clock] = await f.sql`select clock_timestamp() as now`;
  const end = new Date(clock!.now.getTime() - 1000),
    start = new Date(end.getTime() - 1000);
  // Historical local crypto/storage fixture, not a played/heard-media journey.
  await f.sql`update rounds set status='completed',current_stage=null,outcome='affirmative',started_at=${start},completed_at=${end},final_segment_ended_at=${end},transcript_admission_cutoff=${new Date(end.getTime() + 120000)},attendance_resolution_cutoff_at=${new Date(end.getTime() + 3600000)},version=greatest(version,2) where id=${roundId}`;
  const [seat] =
    await f.sql`select id from round_participants where round_id=${roundId} and role='affirmative'`;
  const segmentId = createId(),
    sessionId = createId(),
    workerId = createId(),
    intervalId = createId();
  await f.sql`insert into round_segments(id,round_id,sequence,type,rules_segment_key,started_at,ended_at,duration_ms) values(${segmentId},${roundId},0,'speech','AC',${start},${end},1000)`;
  await f.sql`insert into round_speaking_intervals(id,round_id,segment_id,round_participant_id,started_at,ended_at,started_version,ended_version) values(${intervalId},${roundId},${segmentId},${seat!.id},${start},${end},1,2)`;
  await f.sql`insert into media_sessions(id,round_id,room_name) values(${sessionId},${roundId},${createId()})`;
  const capture = f.store.createMediaCaptureOperations({
    sttLagMs: CAPTURE_STT_LAG_MS,
    captureRule,
    nextId: createId,
    buildProjection: () => {
      throw new Error('Historical evidence fixture cannot invent live play');
    },
    evidence: {
      leaseMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
      maxRoundBytes: 1024 * 1024,
      maxGlobalBytes: 4 * 1024 * 1024,
      maxOutstandingIntents,
    },
  });
  await capture.claimMediaWorkerLease({
    roundId,
    sessionId,
    workerId,
    leaseMs: 15000,
  });
  const at = start.getTime() + 100;
  const frameClock = createFrameClock({
    sentAtMs: 0,
    receivedAtMs: 0,
    serverNowMs: at,
    precisionMs: 0,
  });
  frameClock.observe({ sequence: 0, beforeMs: 10, afterMs: 10 });
  const evidence = frameClock.evidence()!;
  const encoded = canonicalCaptureEvidenceBody({
    version: 1,
    evidenceId: createId(),
    roundId,
    sessionId,
    workerId,
    epoch: 1,
    segmentId,
    roundParticipantId: seat!.id,
    trackId: createId(),
    intervalId,
    historyVersion: 2,
    historyReadAt: end.toISOString(),
    segmentStartedAtMs: start.getTime(),
    startOffsetMs: 100,
    durationMs: 10,
    before: new Date(Math.floor(evidence.window.beforeMs)).toISOString(),
    after: new Date(Math.ceil(evidence.window.afterMs)).toISOString(),
    frames: [
      { pcmS16le: Buffer.alloc(320, 1).toString('base64'), clock: evidence },
    ],
  });
  if (encoded.kind !== 'encoded')
    throw new Error('Invalid synthetic native-body fixture');
  const dir = await mkdtemp(join(tmpdir(), 'daisy-evidence-ingress-'));
  const authorityPath = join(dir, 'authority.sqlite');
  initializeLocalEvidenceAuthority({
    path: authorityPath,
    authorityId: 'c'.repeat(24),
  });
  const authority = openLocalEvidenceAuthority({
    path: authorityPath,
    authorityId: 'c'.repeat(24),
    nowMs: Date.now,
  });
  const custody = openLocalEvidenceCustody({
    path: join(dir, 'keys.sqlite'),
    authority,
  });
  return {
    f,
    roundId,
    capture,
    body: encoded.body,
    encoded,
    dir,
    authority,
    custody,
  };
}
export type EvidenceIngressFixture = Awaited<ReturnType<typeof prepare>>;
export const withEvidenceIngress = (
  work: (f: EvidenceIngressFixture) => Promise<void>,
  options: { readonly maxOutstandingIntents?: number } = {},
) =>
  withRoomRuntime(async (f) => {
    const prepared = await prepare(f, options.maxOutstandingIntents ?? 128);
    try {
      await work(prepared);
    } finally {
      prepared.custody.close();
      prepared.authority.close();
      await f.sql`delete from necessary_evidence where original_round_id=${prepared.roundId}`;
      await f.sql`delete from outbox where topic=${buildRoundTopic(prepared.roundId)}`;
      await rm(prepared.dir, { recursive: true, force: true });
    }
  });
