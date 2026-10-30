import { systemId } from '@daisy/clock';
import {
  foundationSettings,
  foundationDefinition,
} from '@daisy/db/reference-formats';
import {
  roomCastChoiceSchema,
  roomViewSchema,
  roundViewSchema,
  roundBallotReadSchema,
} from '@daisy/protocol';
import { STAGING_TRANSCRIPT_ORIGIN as origin } from './staging-transcript-contract';
const createId = () => systemId.next();
type Cast = { readonly actorId: string; readonly seatRole: string };

/**
 * The two-speech proof format with an AI judge seat. It is not in the
 * picker's catalog (FMT-1), so the proof posts it as a custom format.
 */
export const stagingProofSelection = () => ({
  kind: 'custom' as const,
  competitionType: 'casual' as const,
  definition: {
    ...foundationDefinition,
    seats: { affirmative: 1, negative: 1, judge: 1 },
  },
  config: {
    ...foundationSettings,
    inRoundPrep: { enabled: false },
    speechTiming: {
      countdownMs: 0,
      segmentDurationOverrides: { AC: 60000, NC: 60000 },
    },
  },
});

/** Two bot debaters for the sides and the AI judge for the judge seat (ISSUE-750). */
export function stagingProofCast(bots: readonly Cast[]) {
  const debaters = bots.filter((bot) => bot.seatRole === 'debater');
  const judge = bots.find((bot) => bot.seatRole === 'judge');
  if (debaters.length < 2 || !judge)
    throw new Error('Staging proof catalog unavailable');
  return [
    { role: 'affirmative', actorId: debaters[0]!.actorId },
    { role: 'negative', actorId: debaters[1]!.actorId },
    { role: 'judge', actorId: judge.actorId },
  ] as const;
}

export async function runStagingTranscriptRound(cookie: string) {
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(origin + path, {
      headers: { cookie, origin, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20000),
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(`Staging proof API refused: ${response.status}`);
    return response.json();
  };
  const catalog = await request('/api/rooms/catalog');
  const cast = stagingProofCast(
    catalog.bots
      .map((value: unknown) => roomCastChoiceSchema.parse(value))
      .filter((value: { eligible: boolean }) => value.eligible),
  );
  let room = roomViewSchema.parse(
    (
      await request('/api/rooms', {
        commandId: createId(),
        title: 'Staging transcript provider proof',
        resolution: { kind: 'custom', text: 'Cities should fund transit' },
        visibility: 'unlisted',
        selection: stagingProofSelection(),
      })
    ).view,
  );
  for (const { role, actorId } of cast)
    room = roomViewSchema.parse(
      (
        await request(`/api/rooms/${room.id}/commands`, {
          type: 'assign-seat',
          actorId,
          role,
          slot: 0,
          commandId: createId(),
          expectedVersion: room.version,
        })
      ).view,
    );
  if (
    room.botAdmission?.kind !== 'allowance' ||
    room.botAdmission.refusal ||
    room.botAdmission.remaining < 1
  )
    throw new Error('Dedicated staging allowance unavailable');
  room = roomViewSchema.parse(
    (
      await request(`/api/rooms/${room.id}/commands`, {
        type: 'start-round',
        commandId: createId(),
        expectedVersion: room.version,
      })
    ).view,
  );
  const roundId = room.roundRef?.id;
  if (!roundId) throw new Error('Staging Round not created');
  let round = roundViewSchema.parse(await request(`/api/rounds/${roundId}`));
  round = roundViewSchema.parse(
    (
      await request(`/api/rounds/${roundId}/commands`, {
        version: 1,
        commandId: createId(),
        expectedVersion: round.version,
        command: { type: 'start' },
      })
    ).view,
  );
  console.log(JSON.stringify({ phase: 'started', roundId, roomId: room.id }));
  const deadline = Date.now() + 420000;
  while (round.status !== 'completed' && Date.now() < deadline) {
    await Bun.sleep(3000);
    round = roundViewSchema.parse(await request(`/api/rounds/${roundId}`));
  }
  const ballot = roundBallotReadSchema.parse(
    await request(`/api/rounds/${roundId}/ballots`),
  );
  return {
    roundId,
    roomId: room.id,
    decisive:
      round.status === 'completed' &&
      (round.outcome === 'affirmative' || round.outcome === 'negative'),
    aiBallot: ballot.ballots.some(
      (value) => value.judge === 'ai' && value.status === 'submitted',
    ),
  };
}
