import { systemId } from '@daisy/clock';
import {
  foundationSettings,
  foundationDefinition,
} from '@daisy/db/reference-formats';
import {
  affirmativeSide,
  judgeSeat,
  negativeSide,
  roomCastChoiceSchema,
  roomViewSchema,
  roundViewSchema,
  roundBallotReadSchema,
  sideSeat,
  type RoomCastChoice,
} from '@daisy/protocol';
import { STAGING_TRANSCRIPT_ORIGIN as origin } from './staging-transcript-contract';
const createId = () => systemId.next();
type Cast = Pick<RoomCastChoice, 'actorId' | 'seatKind'>;

/**
 * The two-speech proof format with an AI judge seat. It is not in the
 * picker's catalog (FMT-1), so the proof posts it as a custom format.
 */
export const stagingProofSelection = () => ({
  kind: 'custom' as const,
  competitionType: 'casual' as const,
  definition: {
    ...foundationDefinition,
    seats: { ...foundationDefinition.seats, judges: 1 },
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
  const debaters = bots.filter((bot) => bot.seatKind === 'side');
  const judge = bots.find((bot) => bot.seatKind === 'judge');
  if (debaters.length < 2 || !judge)
    throw new Error('Staging proof catalog unavailable');
  return [
    { seat: sideSeat(affirmativeSide), actorId: debaters[0]!.actorId },
    { seat: sideSeat(negativeSide), actorId: debaters[1]!.actorId },
    { seat: judgeSeat(), actorId: judge.actorId },
  ];
}

export async function runStagingTranscriptRound(cookie: string) {
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(origin + path, {
      headers: { cookie, origin, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20000),
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(`Staging proof API refused: ${response.status}`);
    return response.json();
  };
  const catalog = (await request('/api/rooms/catalog')) as {
    readonly bots: readonly unknown[];
  };
  const cast = stagingProofCast(
    catalog.bots
      .map((value) => roomCastChoiceSchema.parse(value))
      .filter((value) => value.eligible),
  );
  const viewOf = (answer: unknown) => (answer as { view: unknown }).view;
  let room = roomViewSchema.parse(
    viewOf(
      await request('/api/rooms', {
        commandId: createId(),
        title: 'Staging transcript provider proof',
        resolution: { kind: 'custom', text: 'Cities should fund transit' },
        visibility: 'unlisted',
        selection: stagingProofSelection(),
      }),
    ),
  );
  for (const { seat, actorId } of cast)
    room = roomViewSchema.parse(
      viewOf(
        await request(`/api/rooms/${room.id}/commands`, {
          type: 'assign-seat',
          actorId,
          seat,
          commandId: createId(),
          expectedVersion: room.version,
        }),
      ),
    );
  if (
    room.botAdmission?.kind !== 'allowance' ||
    room.botAdmission.refusal ||
    room.botAdmission.remaining < 1
  )
    throw new Error('Dedicated staging allowance unavailable');
  room = roomViewSchema.parse(
    viewOf(
      await request(`/api/rooms/${room.id}/commands`, {
        type: 'start-round',
        commandId: createId(),
        expectedVersion: room.version,
      }),
    ),
  );
  const roundId = room.roundRef?.id;
  if (!roundId) throw new Error('Staging Round not created');
  let round = roundViewSchema.parse(await request(`/api/rounds/${roundId}`));
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
    decisive: round.status === 'completed' && round.outcome?.kind === 'winner',
    aiBallot: ballot.ballots.some((value) => value.judge === 'ai'),
  };
}
