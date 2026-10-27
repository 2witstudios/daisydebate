import { systemId } from '@daisy/clock';
import {
  roomCatalogChoiceSchema,
  roomCastChoiceSchema,
  roomViewSchema,
  roundViewSchema,
  roundBallotReadSchema,
} from '@daisy/protocol';
import { STAGING_TRANSCRIPT_ORIGIN as origin } from './staging-transcript-contract';
const createId = () => systemId.next();

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
  const choice = catalog.choices
    .map((value: unknown) => roomCatalogChoiceSchema.parse(value))
    .find((value: { formatId: string }) => value.formatId === 'foundation');
  const bots = catalog.bots
    .map((value: unknown) => roomCastChoiceSchema.parse(value))
    .filter((value: { eligible: boolean }) => value.eligible);
  if (!choice || bots.length < 3)
    throw new Error('Staging proof catalog unavailable');
  let room = roomViewSchema.parse(
    (
      await request('/api/rooms', {
        commandId: createId(),
        title: 'Staging transcript provider proof',
        topic: 'Cities should fund transit',
        visibility: 'unlisted',
        selection: {
          kind: 'custom',
          competitionType: 'casual',
          definition: {
            ...choice.definition,
            seats: { affirmative: 1, negative: 1, judge: 1 },
          },
          config: {
            ...choice.defaultConfig,
            inRoundPrep: { enabled: false },
            speechTiming: {
              countdownMs: 0,
              segmentDurationOverrides: { AC: 60000, NC: 60000 },
            },
          },
        },
      })
    ).view,
  );
  for (const [index, role] of ['affirmative', 'negative', 'judge'].entries())
    room = roomViewSchema.parse(
      (
        await request(`/api/rooms/${room.id}/commands`, {
          type: 'assign-seat',
          actorId: bots[index].actorId,
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
    room.botAdmission.limit !== 10
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
