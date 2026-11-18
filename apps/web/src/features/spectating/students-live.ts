import { isAppError } from '@daisy/errors';
import type { RoundView } from '@daisy/protocol';
import {
  observedRoundOf,
  type ObservedStage,
} from '../round-runtime/observed-round';
import { spectatorKindOf } from './spectator-view';

/**
 * "Your students, live" on Watch (ADR 0155): each running Youth Round a youth
 * debater the viewer is linked to debates in, as the viewer may watch it.
 */
export type StudentLiveCard = {
  readonly roundId: string;
  /** The Round's own live room, where a linked adult watches it. */
  readonly href: string;
  readonly title: string;
  readonly resolution: string | null;
  /** The debaters by name, then where the Round is: "maya vs jules · Speeches · 1AR". */
  readonly line: string;
};

const stageWords: Readonly<Record<ObservedStage, string>> = {
  strike: 'Starting',
  'opening-prep': 'Starting',
  starting: 'Starting',
  countdown: 'Speeches',
  speech: 'Speeches',
  'cross-ex': 'Speeches',
  between: 'Speeches',
  prep: 'Prep',
  judging: 'Judging',
};

/** One card from the viewer's own Round read; null unless they watch it as a linked adult. */
export const studentLiveCard = (
  view: RoundView,
  title: string,
  nowMs: number,
): StudentLiveCard | null => {
  if (spectatorKindOf(view) !== 'linked-adult') return null;
  const watched = observedRoundOf(view, nowMs);
  const speech = watched.speeches.find((each) => each.state === 'now');
  return {
    roundId: view.id,
    href: `/rounds/${encodeURIComponent(view.id)}/room`,
    title,
    resolution: view.topic,
    line: [
      watched.seats.map((seat) => seat.label).join(' vs '),
      stageWords[watched.stage],
      ...(speech ? [speech.label] : []),
    ].join(' · '),
  };
};

/**
 * The viewer's students' live Rounds. The candidates are only a proposal;
 * each Round is read as the viewer, so the live audience rule alone decides
 * which they see, and a Round they may not watch is left out.
 */
export const studentsLive =
  <Caller>(deps: {
    readonly candidates: (
      caller: Caller,
    ) => Promise<
      readonly { readonly roundId: string; readonly title: string }[]
    >;
    readonly view: (caller: Caller, roundId: string) => Promise<RoundView>;
    readonly nowMs: () => number;
  }) =>
  async (caller: Caller): Promise<readonly StudentLiveCard[]> => {
    const cards = await Promise.all(
      (await deps.candidates(caller)).map(async ({ roundId, title }) => {
        try {
          return studentLiveCard(
            await deps.view(caller, roundId),
            title,
            deps.nowMs(),
          );
        } catch (error) {
          if (isAppError(error) && error.code === 'NOT_FOUND') return null;
          throw error;
        }
      }),
    );
    return cards.filter((card) => card !== null);
  };
