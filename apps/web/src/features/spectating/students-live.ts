import { isAppError } from '@daisy/errors';
import { isTemporaryRefusal } from '@daisy/db/capacity';
import { liveRoomHref } from '../watch/routes';
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
  /** Ranked or casual: a Youth Room holds either (ADR 0156). */
  readonly ranked: boolean;
  /** The debaters by name, then where the Round is: "maya vs jules · Speeches · 1AR". */
  readonly line: string;
};

/** How many candidate Rounds one page load reads at once. */
export const STUDENT_READS_AT_ONCE = 4;

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
    href: liveRoomHref(view.id),
    title,
    resolution: view.topic,
    ranked: view.competitionType === 'ranked',
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
    const one = async ({
      roundId,
      title,
    }: {
      readonly roundId: string;
      readonly title: string;
    }) => {
      try {
        return studentLiveCard(
          await deps.view(caller, roundId),
          title,
          deps.nowMs(),
        );
      } catch (error) {
        // A Round they may not watch, or one the pool refused for now, is
        // left out; the others still show.
        if (isAppError(error) && error.code === 'NOT_FOUND') return null;
        if (isTemporaryRefusal(error)) return null;
        throw error;
      }
    };
    // A few Round reads at a time, so one page load never floods the pool.
    const candidates = await deps.candidates(caller);
    const cards: (StudentLiveCard | null)[] = [];
    for (let at = 0; at < candidates.length; at += STUDENT_READS_AT_ONCE)
      cards.push(
        ...(await Promise.all(
          candidates.slice(at, at + STUDENT_READS_AT_ONCE).map(one),
        )),
      );
    return cards.filter((card) => card !== null);
  };

/**
 * The section, or nothing when it cannot be read: a failure is reported once
 * and never takes the public hub down with it.
 */
export const studentsLiveOrNothing =
  <Caller>(
    read: (caller: Caller) => Promise<readonly StudentLiveCard[]>,
    report: (error: unknown) => void,
  ) =>
  async (caller: Caller): Promise<readonly StudentLiveCard[]> => {
    try {
      return await read(caller);
    } catch (error) {
      report(error);
      return [];
    }
  };
