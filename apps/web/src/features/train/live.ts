import {
  listeningScripts,
  yourScripts,
  type CoachScript,
} from '../../ui/mock/train-practice';
import { motionText, type PracticeConfig } from './practice';
import type { OpponentAdapter } from './opponent';
import { formatClock } from './speech-clock';
import { buildTurns, lengthLabel, turnAt, type Side, type Turn } from './turns';

export type TurnRow = {
  readonly seq: number;
  readonly name: string;
  readonly who: string;
  readonly length: string;
  readonly state: 'done' | 'current' | 'todo' | 'failed';
};

export type SpeechView = {
  readonly kind: 'speech';
  readonly turn: Turn;
  /** Position among the turns this practice runs, from 1. */
  readonly number: number;
  readonly total: number;
  readonly nextSeq: number | null;
  readonly yours: boolean;
  /** "You are speaking" / "The AI debater is speaking". */
  readonly verb: string;
  /** Sample transcript: what the speaker has said so far. */
  readonly text: string;
  /** Null when coaching is off. */
  readonly prompts: readonly string[] | null;
  readonly hint: string | null;
  readonly rows: readonly TurnRow[];
  readonly prepLabel: string;
  readonly youAre: string;
  readonly motion: string;
};

/** The opponent could not give its speech; the practice pauses on it. */
export type UnavailableView = {
  readonly kind: 'unavailable';
  readonly turn: Turn;
  readonly number: number;
  readonly rows: readonly TurnRow[];
};

export type LiveView = SpeechView | UnavailableView;

const rowsFor = (
  turns: readonly Turn[],
  current: Turn,
  failed: boolean,
): readonly TurnRow[] =>
  turns.map((turn) => ({
    seq: turn.seq,
    name: turn.name,
    who: turn.who,
    length: lengthLabel(turn),
    state:
      turn.seq === current.seq
        ? failed
          ? 'failed'
          : 'current'
        : turn.seq < current.seq
          ? 'done'
          : 'todo',
  }));

const scriptFor = (yours: boolean, ordinal: number) =>
  yours
    ? yourScripts[ordinal % yourScripts.length]
    : listeningScripts[ordinal % listeningScripts.length];

/** What is being said, or null when the opponent could not say it. */
function spoken(
  config: PracticeConfig,
  yours: boolean,
  ordinal: number,
  adapter: OpponentAdapter,
): string | null {
  if (yours) return yourScripts[ordinal % yourScripts.length]?.text ?? '';
  const reply = adapter({ motion: motionText(config), ordinal });
  return reply.ok ? reply.text : null;
}

const prepLabel = (prepMinutes: number): string =>
  prepMinutes === 0
    ? 'No prep time'
    : `${formatClock(prepMinutes * 60_000)} of ${formatClock(prepMinutes * 60_000)}`;

/**
 * The live practice screen for a turn: who speaks, what the coach offers and
 * where the debate stands. The opponent's words come through `adapter`, which
 * may be unavailable, in which case the practice stops on that turn.
 */
export function liveView(
  config: PracticeConfig,
  side: Side,
  seq: number,
  adapter: OpponentAdapter,
): LiveView | null {
  const turns = buildTurns(config, side);
  const turn = turnAt(turns, seq);
  if (turn === null) return null;
  const index = turns.indexOf(turn);
  const yours = turn.speaker === 'you';
  const ordinal = turns
    .slice(0, index)
    .filter((earlier) => earlier.speaker === turn.speaker).length;
  const text = spoken(config, yours, ordinal, adapter);
  if (text === null)
    return {
      kind: 'unavailable',
      turn,
      number: index + 1,
      rows: rowsFor(turns, turn, true),
    };
  return speechView({ config, side, turns, turn, index, ordinal, text });
}

const coachFor = (
  config: PracticeConfig,
  script: Omit<CoachScript, 'text'> | undefined,
): Pick<SpeechView, 'prompts' | 'hint'> => ({
  prompts: config.coach ? (script?.prompts ?? []) : null,
  hint: config.hints ? (script?.hint ?? null) : null,
});

type Parts = {
  readonly config: PracticeConfig;
  readonly side: Side;
  readonly turns: readonly Turn[];
  readonly turn: Turn;
  readonly index: number;
  readonly ordinal: number;
  readonly text: string;
};

function speechView({
  config,
  side,
  turns,
  turn,
  index,
  ordinal,
  text,
}: Parts): SpeechView {
  const yours = turn.speaker === 'you';
  const script = scriptFor(yours, ordinal);
  return {
    kind: 'speech',
    turn,
    number: index + 1,
    total: turns.length,
    nextSeq: turns[index + 1]?.seq ?? null,
    yours,
    verb: yours ? 'You are speaking' : 'The AI debater is speaking',
    text,
    ...coachFor(config, script),
    rows: rowsFor(turns, turn, false),
    prepLabel: prepLabel(config.rules.prepMinutes),
    youAre: `You are ${side === 'aff' ? 'Aff' : 'Neg'}`,
    motion: motionText(config),
  };
}
