import type { PointsOfInformationRule } from '@daisy/protocol/format';
import type { RoomView } from '@daisy/protocol/room-contract';
import type { Side, SideKey } from '@daisy/protocol/seats';
import { clockDuration } from '../rooms/duration-input';
import { sideName } from './seat-names';

/**
 * One word per idea, shared by the room, the live round and the receipt:
 * full names first, codes second, never a raw enum or format id.
 */

/** "Negative constructive (NC)". */
export function speechName(segment: {
  readonly key: string;
  readonly label: string;
}): string {
  return `${segment.label} (${segment.key})`;
}

/** "negative constructive": a speech's name inside a sentence, first letter lowered. */
export function speechInSentence(name: string): string {
  return `${name.charAt(0).toLocaleLowerCase()}${name.slice(1)}`;
}

/** "Start negative constructive": the speech's name as written, first letter lowered. */
export function startSpeechLabel(name: string): string {
  return `Start ${speechInSentence(name)}`;
}

/** Points of information, as a rule row's value: Off, or what each point may take. */
export function pointsOfInformationLabel(
  rule: PointsOfInformationRule,
): string {
  return rule.allowed
    ? `On · up to ${clockDuration(rule.maxDurationMs)} each`
    : 'Off';
}

/**
 * Ending a speech early. A returned yield credits the unused speech time
 * back to the speaker's side's in-round prep, never past its budget, and
 * only when the round has prep time; cross-examination time never returns
 * (round-yield.ts).
 */
export function yieldLabel(
  yielding: {
    readonly allowed: boolean;
    readonly returnsTime: boolean;
  } | null,
): string {
  if (!yielding?.allowed) return 'Off';
  return yielding.returnsTime ? 'On · time back to prep' : 'On';
}

/** A draw Room's resolution before its reveal, wherever a topic is shown. */
export const drawnTopicLabel = 'Chosen by strike before the round';

export const resolutionCategoryLabel: Readonly<
  Record<'policy' | 'value' | 'fact', string>
> = { policy: 'Policy', value: 'Value', fact: 'Fact' };

/** "Policy, Value and Fact": an English list of the drawn categories. */
const listOf = (words: readonly string[]) =>
  words.length > 1
    ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
    : (words[0] ?? '');

/** A strike's settings in one line, from its public frozen shape. */
export function strikeSummary(
  draw: Extract<RoomView['config']['resolutionDraw'], { enabled: true }>,
  sides: readonly Side[],
): string {
  const source =
    draw.source.kind === 'bank'
      ? `Daisy’s ${listOf(draw.source.categories.map((c) => resolutionCategoryLabel[c]))} resolutions`
      : 'the host’s list';
  const first = sideName(sides, draw.firstStriker);
  return `${draw.drawSize} from ${source} · ${first} strikes first · ${clockDuration(draw.strikeWindowMs)} per strike`;
}

/**
 * Who struck a drawn resolution, from the viewer's seat: you, your teammate
 * on a two-person side, or the other side by name.
 */
export function strikeLabel(
  strike: {
    readonly kind: 'debater' | 'timeout' | 'automatic';
    readonly side: SideKey;
    readonly byViewer: boolean;
  },
  viewerSide: SideKey | null,
  nameOf: (side: SideKey) => string,
): string {
  const ourSide = strike.side === viewerSide;
  if (strike.kind === 'timeout')
    return ourSide
      ? 'Daisy struck this for you · time ran out'
      : `Daisy struck this for ${nameOf(strike.side)} · time ran out`;
  if (strike.byViewer) return 'You struck this';
  return ourSide
    ? 'Your teammate struck this'
    : `${nameOf(strike.side)} struck this`;
}

const FIVE_MINUTES = 300_000;

/** "about 45 min": speeches, their countdowns and every side's prep, to five minutes. */
export function roundLength({
  speechesMs,
  countdownMs,
  prepPerSideMs,
  sideCount,
  preRoundPrepMs = 0,
}: {
  readonly speechesMs: readonly number[];
  readonly countdownMs: number;
  readonly prepPerSideMs: number | null;
  /** How many sides spend in-round prep. */
  readonly sideCount: number;
  readonly preRoundPrepMs?: number;
}): string {
  const total =
    speechesMs.reduce((sum, ms) => sum + ms + countdownMs, 0) +
    sideCount * (prepPerSideMs ?? 0) +
    preRoundPrepMs;
  const rounded = Math.max(
    FIVE_MINUTES,
    Math.round(total / FIVE_MINUTES) * FIVE_MINUTES,
  );
  return `about ${rounded / 60000} min`;
}

/** A round's rules as label/value rows: m:ss, Off, never a raw value. */
export function ruleRows(rules: {
  readonly preRoundPrepMs: number | null;
  readonly prepPerSideMs: number | null;
  readonly countdownMs: number;
  readonly pointsOfInformation: PointsOfInformationRule;
  readonly yielding: {
    readonly allowed: boolean;
    readonly returnsTime: boolean;
  } | null;
}): readonly (readonly [string, string])[] {
  const poi = rules.pointsOfInformation;
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
    ['Points of information', pointsOfInformationLabel(poi)],
    ...(poi.allowed
      ? [
          [
            'Protected time in each speech',
            `First ${clockDuration(poi.protectedStartMs)} and last ${clockDuration(poi.protectedEndMs)}`,
          ] as const,
        ]
      : []),
    ['Ending a speech early', yieldLabel(rules.yielding)],
  ];
}

/** The league browser's groups (FMT-3). */
export const formatFamilyLabel = {
  policy: 'Policy',
  value: 'Value',
  parli: 'Parli',
  other: 'Other formats',
} as const;
