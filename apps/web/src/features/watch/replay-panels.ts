import {
  debaterOn,
  isParticipant,
  type Ballots,
  type Side,
  type Visibility,
  type WatchRound,
  type WatchViewer,
} from './round';
import {
  dayLabel,
  durationLabel,
  modeLabel,
  rulesLabel,
  sideLabel,
  visibilityLabel,
} from './labels';
import { replayHref } from './routes';
import type { ReplayQuery } from './replay-query';

type Published = Extract<Ballots, { state: 'published' }>;

export type ResultPanel =
  | { readonly kind: 'pending'; readonly received: number; readonly of: number }
  | {
      readonly kind: 'published';
      readonly headline: string;
      readonly lines: readonly {
        readonly who: string;
        readonly range: string;
        readonly delta: string;
      }[];
      readonly note: string;
      readonly judges: readonly {
        readonly title: string;
        readonly summary: string;
        readonly reasons: string;
      }[];
    };

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

function ratingLines(round: WatchRound, ballots: Published) {
  return (['aff', 'neg'] as const).flatMap((side: Side) => {
    const change = ballots[side];
    return change === null
      ? []
      : [
          {
            who: `@${debaterOn(round, side).handle}, ${sideLabel(side)}`,
            range: `${change.from} to ${change.to}`,
            delta: signed(change.to - change.from),
          },
        ];
  });
}

/** The result, or how many ballots are in while it is still pending. */
export function buildResult(
  round: WatchRound,
  ballots: Ballots,
  season: string,
): ResultPanel {
  if (ballots.state === 'pending')
    return { kind: 'pending', received: ballots.received, of: ballots.of };
  return {
    kind: 'published',
    headline: `${sideLabel(ballots.winner)} wins, ${ballots.judgesFor} to ${ballots.judgesAgainst}`,
    lines: ratingLines(round, ballots),
    note: round.mode === 'ranked' ? `Ranked · season ${season}` : 'Casual',
    judges: ballots.judges.map((judge, index) => ({
      title: `Judge ${index + 1}`,
      summary: `${sideLabel(judge.winner)} · Aff ${judge.affPoints}, Neg ${judge.negPoints}`,
      reasons: judge.reasons,
    })),
  };
}

const DESCRIPTIONS: Readonly<Record<Visibility, string>> = {
  public: 'Anyone can replay it.',
  unlisted: 'Anyone with the link can replay it.',
  private: 'Only the debaters and judges can replay it.',
};

const OPTIONS: readonly {
  readonly value: Visibility;
  readonly label: string;
  readonly text: string;
}[] = [
  {
    value: 'public',
    label: 'Public',
    text: 'Listed in the archive',
  },
  {
    value: 'unlisted',
    label: 'Unlisted',
    text: 'Anyone with the link',
  },
  {
    value: 'private',
    label: 'Private',
    text: 'Debaters and judges only. Not for ranked debates.',
  },
];

export type SharePanel = {
  readonly visibility: string;
  readonly description: string;
  /** Only the people seated can change who may replay. */
  readonly canManage: boolean;
  readonly manageOpen: boolean;
  readonly options: readonly {
    readonly value: Visibility;
    readonly label: string;
    readonly text: string;
    readonly checked: boolean;
    /** Ranked recordings stay checkable, so they cannot go private. */
    readonly locked: boolean;
  }[];
  readonly unchanged: boolean;
  readonly linkPath: string;
};

/** Who can replay, the owner's visibility manager and the link to share. */
export function buildShare(
  round: WatchRound,
  viewer: WatchViewer,
  query: ReplayQuery,
): SharePanel {
  const draft = query.vis ?? round.visibility;
  const canManage = isParticipant(round, viewer);
  return {
    visibility: visibilityLabel(round.visibility),
    description: DESCRIPTIONS[round.visibility],
    canManage,
    manageOpen: canManage && query.manage,
    options: OPTIONS.map((option) => ({
      ...option,
      checked: option.value === draft,
      locked: round.mode === 'ranked' && option.value === 'private',
    })),
    unchanged: draft === round.visibility,
    linkPath: replayHref(round.id),
  };
}

export type DetailRow = { readonly label: string; readonly value: string };

/** The facts block: mode, rules, season, length, judges and date. */
export function buildDetails(
  round: WatchRound,
  season: string,
  lengthSeconds: number,
  endedAt: string,
): readonly DetailRow[] {
  return [
    { label: 'Mode', value: modeLabel(round.mode) },
    { label: 'Rules', value: rulesLabel(round) },
    { label: 'Season', value: season },
    { label: 'Length', value: durationLabel(lengthSeconds) },
    { label: 'Judges', value: `${round.judges.length}, assigned by Daisy` },
    { label: 'Recorded', value: dayLabel(endedAt) },
  ];
}
