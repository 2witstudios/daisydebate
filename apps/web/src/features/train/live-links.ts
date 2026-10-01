import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { trainDestinations } from './actions';
import type { SpeechView } from './live';
import { practiceHref, type PracticeConfig } from './practice';
import type { HubQuery } from './query';
import { withPlanContext } from './query';

/** The live screen's URL state beyond the practice's own config. */
export type LiveQuery = {
  /** The turn's position in the debate; the screen shows the next one at or after it. */
  readonly seq: number;
  readonly hint: boolean;
  readonly confirmEnd: boolean;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const seqSchema = z
  .string()
  .regex(/^\d{1,2}$/)
  .transform(Number)
  .catch(1);

export const parseLiveQuery = (params: SearchParams): LiveQuery => ({
  seq: seqSchema.parse(first(params['turn'])),
  hint: first(params['hint']) === '1',
  confirmEnd: first(params['confirm']) === 'end',
});

export type LiveLinks = {
  readonly leave: string;
  readonly hint: string;
  /** To the next speech, or to the debrief after the last one. */
  readonly next: { readonly href: string; readonly label: string };
  readonly askEnd: string;
  readonly keepGoing: string;
  readonly endNow: string;
  /** Only an opponent's speech can be reported as unavailable. */
  readonly reportProblem: string | null;
};

/** Every link the live screen offers, carrying config and plan along. */
export function liveLinks(
  config: PracticeConfig,
  plan: HubQuery,
  view: SpeechView,
  query: LiveQuery,
): LiveLinks {
  const here = (extra: Record<string, string>) =>
    practiceHref(trainDestinations.practiceLive, config, plan, {
      turn: String(view.turn.seq),
      ...extra,
    });
  return {
    leave: withPlanContext(trainDestinations.hub, plan),
    hint: here(query.hint ? {} : { hint: '1' }),
    next:
      view.nextSeq === null
        ? {
            href: practiceHref(trainDestinations.practiceDebrief, config, plan),
            label: 'Finish and see debrief',
          }
        : {
            href: practiceHref(trainDestinations.practiceLive, config, plan, {
              turn: String(view.nextSeq),
            }),
            label: 'End speech',
          },
    askEnd: here({ confirm: 'end' }),
    keepGoing: here({}),
    endNow: practiceHref(trainDestinations.practiceDebrief, config, plan, {
      upto: String(view.turn.seq),
    }),
    reportProblem: view.yours
      ? null
      : practiceHref(trainDestinations.practiceUnavailable, config, plan, {
          turn: String(view.turn.seq),
        }),
  };
}

export type UnavailableLinks = {
  readonly leave: string;
  readonly tryAgain: string;
  readonly continueSolo: string;
  readonly end: string;
};

/** Where a stopped practice can go from the opponent-unavailable screen. */
export function unavailableLinks(
  config: PracticeConfig,
  plan: HubQuery,
  seq: number,
): UnavailableLinks {
  const turn = String(seq);
  return {
    leave: withPlanContext(trainDestinations.hub, plan),
    tryAgain: practiceHref(trainDestinations.practiceLive, config, plan, {
      turn,
    }),
    continueSolo: practiceHref(
      trainDestinations.practiceLive,
      { ...config, opponent: 'solo' },
      plan,
      { turn },
    ),
    end: practiceHref(trainDestinations.practiceDebrief, config, plan, {
      upto: turn,
    }),
  };
}
