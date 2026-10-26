import type { RoomView } from '@daisy/protocol';
import { clockDuration } from '../rooms/duration-input';

/**
 * One word per idea, shared by the room, the live round and the receipt:
 * full names first, codes second, never a raw enum or format id.
 */

type Interaction = RoomView['config'];

/** "1v1", "2v2": debaters per side. */
export function shapeLabel(seats: {
  readonly affirmative: number;
  readonly negative: number;
}): string {
  return `${seats.affirmative}v${seats.negative}`;
}

/** "Negative constructive (NC)". */
export function speechName(segment: {
  readonly key: string;
  readonly label: string;
}): string {
  return `${segment.label} (${segment.key})`;
}

/** "Start negative constructive": the speech's name as written, first letter lowered. */
export function startSpeechLabel(name: string): string {
  return `Start ${name.charAt(0).toLocaleLowerCase()}${name.slice(1)}`;
}

export const crossExModeLabel: Readonly<
  Record<Interaction['crossExamination']['crossExMode'], string>
> = { ordered: 'Questioner leads', free: 'Open floor' };

export const interruptionLabel: Readonly<
  Record<NonNullable<Interaction['interruptions']>['mode'], string>
> = {
  disabled: 'Off',
  cross_ex_only: 'Only during cross-examination',
  enabled: 'During any speech',
};

/**
 * Ending a speech early. A returned yield credits the unused speech time
 * back to the speaker's side's in-round prep, never past its budget, and
 * only when the round has prep time (round-floor.ts).
 */
export function yieldLabel(
  yielding: {
    readonly allowed: boolean;
    readonly returnsTime: boolean;
  } | null,
): string {
  if (!yielding?.allowed) return 'Off';
  return yielding.returnsTime
    ? 'On — unused time goes back to that side’s prep time, when prep time is on'
    : 'On — unused time is dropped';
}

const FIVE_MINUTES = 300_000;

/** "about 30 min": speeches, their countdowns and both sides' prep, to five minutes. */
export function roundLength({
  speechesMs,
  countdownMs,
  prepPerSideMs,
}: {
  readonly speechesMs: readonly number[];
  readonly countdownMs: number;
  readonly prepPerSideMs: number | null;
}): string {
  const total =
    speechesMs.reduce((sum, ms) => sum + ms + countdownMs, 0) +
    2 * (prepPerSideMs ?? 0);
  const rounded = Math.max(
    FIVE_MINUTES,
    Math.round(total / FIVE_MINUTES) * FIVE_MINUTES,
  );
  return `about ${rounded / 60000} min`;
}

type Mode = NonNullable<Interaction['interruptions']>['mode'];

/** A round's rules as label/value rows: m:ss, Off, never a raw value. */
export function ruleRows(rules: {
  readonly preRoundPrepMs: number | null;
  readonly prepPerSideMs: number | null;
  readonly countdownMs: number;
  readonly crossExMode: Interaction['crossExamination']['crossExMode'];
  readonly interruptions: {
    readonly mode: Mode;
    readonly minRemainingMs: number;
  } | null;
  readonly yielding: {
    readonly allowed: boolean;
    readonly returnsTime: boolean;
  } | null;
}): readonly (readonly [string, string])[] {
  const { interruptions } = rules;
  return [
    [
      'Prep before the round',
      rules.preRoundPrepMs === null
        ? 'Off'
        : clockDuration(rules.preRoundPrepMs),
    ],
    [
      'Prep time',
      rules.prepPerSideMs === null
        ? 'Off'
        : `${clockDuration(rules.prepPerSideMs)} per side`,
    ],
    ['Countdown before each speech', clockDuration(rules.countdownMs)],
    ['Cross-examination', crossExModeLabel[rules.crossExMode]],
    ['Interruptions', interruptionLabel[interruptions?.mode ?? 'disabled']],
    ...(interruptions && interruptions.mode !== 'disabled'
      ? [
          [
            'Protected end of each speech',
            clockDuration(interruptions.minRemainingMs),
          ] as const,
        ]
      : []),
    ['Ending a speech early', yieldLabel(rules.yielding)],
  ];
}
