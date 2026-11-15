import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import type { LoadedDrawCommand } from '@daisy/db/tab';
import { formatDefinitionSchema } from '@daisy/protocol';
import { audiences, releaseThings } from '@daisy/protocol/lobby';
import { drawOverrideSchema } from '@daisy/protocol/lobby/draw-command';
import {
  drawFixturePeople,
  type DrawFacts,
  type DrawFixtureFacts,
} from '../commands/draw';
import type {
  EngineStage,
  EngineStageHistory,
  EngineRatings,
  EngineFormat,
} from '../commands/tab-engine';
import { commandDigest } from './command-digest';
import { engineSettings } from './engine-settings';
import { eventSettingResolution } from './event-setting-resolution';
import { drawEligibleActors } from './draw-admission';

const inputsSchema = z.strictObject({
  engine: z
    .looseObject({
      engine: z.record(z.string(), z.string()),
      settingsDigest: z.string(),
      seed: z.string(),
      cutoff: z.int().nonnegative(),
      results: z.array(z.string()),
    })
    .nullable(),
  settingsDigest: z.string(),
  broken: z.array(z.string()),
  overrides: z.array(drawOverrideSchema),
});
/** Facts owned by the competition fold, not reconstructed as invented judge ballots. */
export type DrawCompetition = {
  readonly stage: EngineStage;
  readonly history: EngineStageHistory;
  readonly ratings: EngineRatings;
  readonly breakChoicesPending: boolean;
};
type StoredFixture = DrawFixtureFacts & {
  readonly tabRoundId: string;
  readonly eventId: string;
};
const fixtureFacts = (loaded: LoadedDrawCommand): StoredFixture[] =>
  loaded.fixtures.map((fixture) => {
    const round = loaded.roomRounds.find(
      (row) => row.roomId === fixture.roomId,
    );
    const result = loaded.fixtureResults.some(
      (row) => row.fixtureId === fixture.id,
    );
    const ballot =
      round && loaded.submittedBallots.some((row) => row.roundId === round.id);
    return {
      ...fixture,
      state:
        fixture.status !== 'published'
          ? null
          : result
            ? 'has_result'
            : ballot
              ? 'ballot_in'
              : round
                ? 'round_live'
                : 'open',
      entries: loaded.fixtureEntries
        .filter((row) => row.fixtureId === fixture.id)
        .sort((a, b) => a.position - b.position)
        .map((row) => ({
          entryId: row.entryId,
          position: row.position,
          side: row.side,
          members: loaded.members
            .filter((member) => member.entryId === row.entryId)
            .map((member) => member.actorId),
        })),
      judges: loaded.fixtureJudges
        .filter((row) => row.fixtureId === fixture.id)
        .map((row) => {
          const judge = loaded.judges.find(
            (judge) => judge.id === row.tournamentJudgeId,
          );
          if (!judge)
            throw createAppError('INVARIANT', 'Fixture judge is missing');
          return {
            tournamentJudgeId: judge.id,
            person: judge.actorId,
            chair: row.chair,
          };
        }),
    };
  });
const descriptor = (
  definition: ReturnType<typeof formatDefinitionSchema.parse>,
): EngineFormat => {
  if (definition.outcome.kind === 'winner' && definition.sides.length === 2)
    return { outcome: 'winner', sides: 2 };
  if (
    definition.outcome.kind === 'ranking' &&
    definition.outcome.of === 'sides' &&
    definition.sides.length === 4
  )
    return { outcome: 'ranking', of: 'sides', sides: 4 };
  if (
    definition.outcome.kind === 'ranking' &&
    definition.outcome.of === 'speakers'
  )
    return { outcome: 'ranking', of: 'speakers' };
  throw createAppError('INVARIANT', 'Event pin has no tab-engine format');
};

/** Maps fenced persisted facts to the merged decider and actual engine vocabulary. */
export const drawFacts = (
  loaded: LoadedDrawCommand,
  competition: DrawCompetition,
  input: {
    readonly commandId: string;
    readonly now: string;
    readonly newId: () => string;
  },
): DrawFacts => {
  const { configuration, round, stage, slot } = loaded;
  const { event } = configuration;
  const eligible = drawEligibleActors(loaded.accounts);
  if (
    !stage ||
    stage.kind !== competition.stage.kind ||
    (competition.stage.kind === 'elimination' &&
      competition.stage.division !== stage.division)
  )
    throw createAppError(
      'INVARIANT',
      'Competition fold differs from the actual stage',
    );
  const definition = formatDefinitionSchema.parse(
    configuration.definition.definition,
  );
  const { chain, rows, format, settings } =
    eventSettingResolution(configuration);
  const fixtures = fixtureFacts(loaded);
  const inSlot = new Set(
    loaded.rounds
      .filter(
        (row) => slot && row.timeSlotId === slot.id && row.eventId !== event.id,
      )
      .map((row) => row.id),
  );
  const elsewhere = fixtures.filter(
    (fixture) =>
      fixture.status === 'published' &&
      fixture.kind !== 'bye' &&
      inSlot.has(fixture.tabRoundId),
  );
  const releasesAtOnce = releaseThings.flatMap((thing) =>
    audiences.flatMap((audience) =>
      settings[`audience.${thing}`].value[audience] === 'at_once' &&
      !loaded.releases.some(
        (row) =>
          row.tabRoundId === round.id &&
          row.thing === thing &&
          row.audience === audience,
      )
        ? [{ thing, audience }]
        : [],
    ),
  );
  const values = engineSettings(chain, rows, format);
  return {
    commandId: input.commandId,
    now: input.now,
    freshIds: Array.from(
      {
        length:
          loaded.entries.filter((entry) => entry.eventId === event.id).length +
          releasesAtOnce.length +
          2,
      },
      input.newId,
    ),
    event: {
      ...event,
      format: descriptor(definition),
      sideNames: definition.sides.length
        ? definition.sides.map((side) => side.key)
        : null,
    },
    tabRound: {
      id: round.id,
      number: round.number,
      name: round.name,
      stage: competition.stage,
      timing: stage.timing,
      timeSlot: slot ? { id: slot.id, version: slot.version } : null,
    },
    versions: loaded.versions
      .filter((draw) => draw.tabRoundId === round.id)
      .map((draw) => ({
        ...draw,
        inputs: inputsSchema.parse(draw.inputs),
        fixtureIds: loaded.drawFixtures
          .filter((row) => row.drawId === draw.id)
          .map((row) => row.fixtureId),
      })),
    fixtures: fixtures.filter((fixture) => fixture.tabRoundId === round.id),
    settings: {
      kind: 'resolved',
      values,
      digest: commandDigest(
        Object.fromEntries(
          Object.entries(settings).map(([key, setting]) => [
            key,
            setting.value,
          ]),
        ),
      ),
    },
    engine: {
      entries: loaded.entries
        .filter(
          (entry) =>
            entry.eventId === event.id &&
            (entry.status === 'accepted' || entry.status === 'withdrawn'),
        )
        .map((entry) => ({
          id: entry.id,
          members: loaded.members
            .filter((row) => row.entryId === entry.id)
            .map((row) => row.actorId),
          protection: entry.schoolOrganizationId
            ? [{ scope: 'school', key: entry.schoolOrganizationId }]
            : [],
          division: entry.division,
          status: entry.status === 'accepted' ? 'active' : 'withdrawn',
          breakEligible: true,
        })),
      history: competition.history,
      ratings: competition.ratings,
      judges: loaded.judges
        .filter(
          (judge) => judge.status === 'accepted' && eligible.has(judge.actorId),
        )
        .map((judge) => {
          const seated = fixtures.filter(
            (fixture) =>
              fixture.status === 'published' &&
              fixture.tabRoundId !== round.id &&
              loaded.roomRounds.some((row) => row.roomId === fixture.roomId) &&
              fixture.judges.some((one) => one.tournamentJudgeId === judge.id),
          );
          const allowed = loaded.judgeEvents
            .filter((row) => row.tournamentJudgeId === judge.id)
            .map((row) => row.eventId);
          const strikes = loaded.strikes.filter(
            (row) => row.tournamentJudgeId === judge.id,
          );
          const outstanding = fixtures
            .filter(
              (fixture) =>
                fixture.status === 'published' &&
                fixture.judges.some(
                  (one) => one.tournamentJudgeId === judge.id,
                ) &&
                fixture.state !== 'has_result',
            )
            .filter((fixture) => {
              const actualRound = loaded.roomRounds.find(
                (row) => row.roomId === fixture.roomId,
              );
              return (
                actualRound &&
                !loaded.submittedBallots.some(
                  (row) =>
                    row.roundId === actualRound.id &&
                    row.actorId === judge.actorId,
                )
              );
            });
          return {
            id: judge.id,
            person: judge.actorId,
            protection: judge.schoolOrganizationId
              ? [{ scope: 'school', key: judge.schoolOrganizationId }]
              : [],
            events: allowed.length ? allowed : null,
            conflicts: strikes
              .filter((row) => row.source !== 'entry')
              .map((row) => row.entryId),
            strikes: strikes
              .filter((row) => row.source === 'entry')
              .map((row) => row.entryId),
            judged: [
              ...new Set(
                seated.flatMap((fixture) =>
                  fixture.entries.map((entry) => entry.entryId),
                ),
              ),
            ],
            tabRoundsJudged: new Set(
              seated.map((fixture) => fixture.tabRoundId),
            ).size,
            outstandingBallots: outstanding.length,
            chair: judge.chairQualified,
            available:
              stage.timing === 'windowed' ||
              loaded.availability.some(
                (row) =>
                  row.tournamentJudgeId === judge.id &&
                  row.timeSlotId === slot?.id &&
                  row.available,
              ),
          };
        }),
      commitments: elsewhere.map((fixture) => ({
        event: fixture.eventId,
        fixture: fixture.id,
        people: drawFixturePeople(fixture),
      })),
    },
    breakChoicesPending: competition.breakChoicesPending,
    slotElsewhere: elsewhere.flatMap(drawFixturePeople),
    releasesAtOnce,
  };
};
