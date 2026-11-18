import type { LoadedFixtureCommand } from '@daisy/db/tab';
import type { FixtureFacts } from '../commands/fixture';
import { resultFacts } from './result-facts';
import { eventSettingResolution } from './event-setting-resolution';

/** The actual current panel is separate from the immutable competitive source. */
export function fixtureFacts(
  loaded: LoadedFixtureCommand,
  input: {
    readonly commandId: string;
    readonly resultId: string;
    readonly roomId: string;
  },
): FixtureFacts {
  const { context } = loaded;
  const { settings } = eventSettingResolution(context.configuration);
  const panel = settings['judging.panel'].value;
  const pinnedSize = context.room?.rulesSnapshot.seats.judges;
  return {
    ...resultFacts(loaded.competition, {
      now: loaded.checkedAt,
      commandId: input.commandId,
      resultId: input.resultId,
    }),
    minted: { resultId: input.resultId, roomId: input.roomId },
    stageKind: context.stage.kind,
    judgingPanel:
      pinnedSize === undefined
        ? panel
        : {
            ...panel,
            [context.stage.kind]: {
              ...panel[context.stage.kind],
              size: pinnedSize,
            },
          },
    judgingForces: {
      'judging.availability': settings['judging.availability'].value.force,
      'judging.strike': settings['judging.strike'].value.force,
      'judging.conflict': settings['judging.conflict'].value.force,
      'judging.same_school': settings['judging.same_school'].value.force,
      'judging.chair': settings['judging.chair'].value.force,
    },
    panel: loaded.panel,
    ballots: loaded.ballots,
    judges: loaded.judges.map((judge) => {
      const allowed = loaded.allowedEvents.filter(
        (row) => row.tournamentJudgeId === judge.id,
      );
      return {
        ...judge,
        availableInSlot:
          context.stage.timing === 'windowed'
            ? null
            : loaded.availability.some(
                (row) => row.tournamentJudgeId === judge.id && row.available,
              ),
        allowedEvent:
          !allowed.length ||
          allowed.some((row) => row.eventId === context.fixture.eventId),
      };
    }),
    strikes: loaded.strikes,
    slotBookings: loaded.slotBookings,
  };
}
