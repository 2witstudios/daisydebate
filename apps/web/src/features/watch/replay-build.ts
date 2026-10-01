import type { WatchDebate, WatchViewer } from './debate';
import {
  durationLabel,
  modeLabel,
  rulesLabel,
  dayLabel,
  visibilityLabel,
} from './labels';
import {
  buildDetails,
  buildResult,
  buildShare,
  type DetailRow,
  type ResultPanel,
  type SharePanel,
} from './replay-panels';
import type { ReplayQuery } from './replay-query';
import {
  buildPlayer,
  buildTimeline,
  buildTranscript,
  replayContext,
  type ReplayPlayer,
  type ReplayTimeline,
  type ReplayTimetable,
  type ReplayTranscript,
} from './replay-view';

export type ReplayView = {
  readonly id: string;
  readonly title: string;
  readonly badges: {
    readonly mode: string;
    readonly rules: string;
    readonly visibility: string;
  };
  readonly subtitle: string;
  readonly query: ReplayQuery;
  readonly player: ReplayPlayer;
  readonly timeline: ReplayTimeline;
  /** Decorative reaction density, 0 to 5 per slot; sample data. */
  readonly density: readonly number[];
  readonly transcript: ReplayTranscript;
  readonly result: ResultPanel;
  readonly share: SharePanel;
  readonly details: readonly DetailRow[];
};

type Input = {
  readonly debate: WatchDebate & {
    readonly state: Extract<WatchDebate['state'], { status: 'ended' }>;
  };
  readonly viewer: WatchViewer;
  readonly query: ReplayQuery;
  readonly table: ReplayTimetable;
  readonly density: readonly number[];
  readonly context: { readonly resolution: string; readonly season: string };
};

/** The replay of a recording a viewer may open. Pure. */
export function buildReplayView(input: Input): ReplayView {
  const { debate, viewer, query, table, context } = input;
  const ctx = replayContext(debate, query, table);
  const { recording, ballots } = debate.state;
  return {
    id: debate.id,
    title: debate.title,
    badges: {
      mode: modeLabel(debate.mode),
      rules: rulesLabel(debate),
      visibility: visibilityLabel(debate.visibility),
    },
    subtitle: `@${debate.aff.handle} vs @${debate.neg.handle} · ${dayLabel(recording.endedAt)} · ${durationLabel(ctx.total)} · ${context.resolution}`,
    query,
    player: buildPlayer(ctx),
    timeline: buildTimeline(ctx),
    density: input.density,
    transcript: buildTranscript(ctx),
    result: buildResult(debate, ballots, context.season),
    share: buildShare(debate, viewer, query),
    details: buildDetails(debate, context.season, ctx.total, recording.endedAt),
  };
}
