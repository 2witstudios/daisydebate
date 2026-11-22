import type { FormatChange } from '@daisy/protocol/format-standing';
import type { Side } from '@daisy/protocol/seats';
import { interruptionLabel, strikeSummary } from '../debate-room/vocabulary';
import { sideShortName } from '../debate-room/seat-names';
import { clockDuration } from './duration-input';

type SeatsOf = Extract<FormatChange, { kind: 'seats' }>['of'];

/** "Aff debaters", "Judges": the seats a change counts. */
const seatsLabel = (of: SeatsOf, sides: readonly Side[]): string => {
  switch (of.kind) {
    case 'side':
      return `${sideShortName(sides, of.side)} debaters`;
    case 'speaker':
      return 'Speakers';
    case 'judge':
      return 'Judges';
    case 'moderator':
      return 'Moderators';
  }
};

const clockOrOff = (ms: number | null) =>
  ms === null ? 'off' : clockDuration(ms);
const onOff = (value: { readonly allowed: boolean } | null) =>
  value?.allowed ? 'on' : 'off';
const strikeOrOff = (
  draw: Extract<FormatChange, { kind: 'resolution-draw' }>['from'],
  sides: readonly Side[],
) => (draw.enabled ? strikeSummary(draw, sides) : 'off');
const listed = (verb: string, keys: readonly string[]) =>
  keys.length ? `${verb} ${keys.join(', ')}` : null;

type Lines = {
  readonly [K in FormatChange['kind']]: (
    change: Extract<FormatChange, { kind: K }>,
    sides: readonly Side[],
  ) => string;
};

/** Each change kind in the room's vocabulary, before → after. */
const lines: Lines = {
  seats: (c, sides) => `${seatsLabel(c.of, sides)} ${c.from} → ${c.to}`,
  segments: (c) =>
    `Speeches ${[
      listed('added', c.added),
      listed('removed', c.removed),
      listed('changed', c.changed),
    ]
      .filter(Boolean)
      .join(' · ')}`,
  'segment-duration': (c) =>
    `${c.key} ${clockDuration(c.fromMs)} → ${clockDuration(c.toMs)}`,
  countdown: (c) =>
    `Countdown ${clockDuration(c.fromMs)} → ${clockDuration(c.toMs)}`,
  'in-round-prep': (c) =>
    `Prep per side ${clockOrOff(c.fromMs)} → ${clockOrOff(c.toMs)}`,
  'pre-round-prep': (c) =>
    `Prep before the round ${clockOrOff(c.fromMs)} → ${clockOrOff(c.toMs)}`,
  interruptions: (c) =>
    `Interruptions: ${interruptionLabel[c.from.allowed]} → ${interruptionLabel[c.to.allowed]}`,
  yield: (c) => `Ending a speech early: ${onOff(c.from)} → ${onOff(c.to)}`,
  'resolution-draw': (c, sides) =>
    `Resolution strike: ${strikeOrOff(c.from, sides)} → ${strikeOrOff(c.to, sides)}`,
};

/** One line of the Custom card: what changed from the room's basis, before → after. */
export function formatChangeLine(
  change: FormatChange,
  sides: readonly Side[],
): string {
  return (
    lines[change.kind] as (
      change: FormatChange,
      sides: readonly Side[],
    ) => string
  )(change, sides);
}
