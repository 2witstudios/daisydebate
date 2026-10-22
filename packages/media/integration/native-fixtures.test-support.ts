import { SQL } from 'bun';
import { createDatabase } from '@daisy/db';
import { validRules } from '@daisy/db/testing';
import { createMediaSessionStore } from '@daisy/db/media-session';
import { createId } from '@paralleldrive/cuid2';

export async function withHistoricalSeat(
  databaseUrl: string,
  work: (input: {
    readonly binding: { roomName: string; identity: string };
    readonly calibrate: () => Promise<
      import('../src/publication-clock').ClockCalibration
    >;
    readonly authorizeWindow: (window: {
      before: string;
      after: string;
    }) => Promise<boolean>;
    readonly closeEligibility: () => Promise<void>;
  }) => Promise<void>,
) {
  const db = createDatabase({ url: databaseUrl, nextActorId: createId });
  const fixture = new SQL(databaseUrl);
  const media = createMediaSessionStore({ url: databaseUrl, nextId: createId });
  const roundId = createId(),
    actorId = createId(),
    seatId = createId(),
    segmentId = createId();
  try {
    await db.createRound({
      id: roundId,
      createdByActorId: null,
      resolution: 'Synthetic native media clock proof',
      competitionType: 'practice',
      length: 'full',
      formatId: 'foundation',
      formatVersion: 1,
      presetVersion: null,
      rules: validRules,
    });
    await fixture`insert into actors (id,kind) values (${actorId},'bot')`;
    await fixture`insert into round_participants (id,round_id,actor_id,role,slot) values (${seatId},${roundId},${actorId},'affirmative',0)`;
    await fixture`update rounds set status='active',current_stage='live',started_at=clock_timestamp()-interval '1 second' where id=${roundId}`;
    await fixture`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,duration_ms) values (${segmentId},${roundId},0,'speech','AC',clock_timestamp()-interval '1 second',60000)`;
    await fixture`insert into round_speaking_intervals (id,round_id,segment_id,round_participant_id,started_at,started_version) values (${createId()},${roundId},${segmentId},${seatId},clock_timestamp()-interval '1 second',1)`;
    const binding = await media.ensureBinding({
      roundId,
      roundParticipantId: seatId,
    });
    await work({
      binding,
      calibrate: async () => {
        const sentAtMs = performance.now();
        const serverNowMs = Date.parse(await db.databaseNow());
        return {
          sentAtMs,
          receivedAtMs: performance.now(),
          serverNowMs,
          precisionMs: 1,
        };
      },
      authorizeWindow: async (window) =>
        (
          await db.readRoundSpeakingEligibility({
            roundId,
            segmentId,
            roundParticipantId: seatId,
            expectedVersion: 1,
            ...window,
          })
        ).eligible,
      closeEligibility: async () => {
        await fixture`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=2 where round_id=${roundId}`;
      },
    });
  } finally {
    await fixture`delete from rounds where id=${roundId}`;
    await fixture`delete from actors where id=${actorId}`;
    await media.close();
    await db.close();
    await fixture.close();
  }
}

export const waitForCadence = async (dueMs: number, signal: AbortSignal) => {
  while (performance.now() < dueMs) {
    if (signal.aborted) return;
    // This timer is the production pacing mechanism, never a test's guess
    // that remote state will become true after a delay.
    await Bun.sleep(Math.max(1, dueMs - performance.now()));
  }
};
export const pcmJob = () => {
  const data = new Int16Array(9600);
  for (let index = 0; index < data.length; index++)
    data[index] = index % 80 < 40 ? 1000 : -1000;
  return data;
};
