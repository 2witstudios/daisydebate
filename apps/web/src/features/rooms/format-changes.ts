import type { FormatChange } from '@daisy/protocol';
import {
  crossExModeLabel,
  interruptionLabel,
  strikeSummary,
} from '../debate-room/vocabulary';
import { clockDuration } from './duration-input';

const roleLabel = {
  affirmative: 'Aff debaters',
  negative: 'Neg debaters',
  judge: 'Judges',
} as const;

const clockOrOff = (ms: number | null) =>
  ms === null ? 'off' : clockDuration(ms);
const onOff = (value: { readonly allowed: boolean } | null) =>
  value?.allowed ? 'on' : 'off';
const interruptions = (
  value: Extract<FormatChange, { kind: 'interruptions' }>['from'],
) => interruptionLabel[value?.allowed ?? 'disabled'];
const strikeOrOff = (
  draw: Extract<FormatChange, { kind: 'resolution-draw' }>['from'],
) => (draw.enabled ? strikeSummary(draw) : 'off');
const listed = (verb: string, keys: readonly string[]) =>
  keys.length ? `${verb} ${keys.join(', ')}` : null;

type Lines = {
  readonly [K in FormatChange['kind']]: (
    change: Extract<FormatChange, { kind: K }>,
  ) => string;
};

/** Each change kind in the room's vocabulary, before → after. */
const lines: Lines = {
  seats: (c) => `${roleLabel[c.role]} ${c.from} → ${c.to}`,
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
  'cross-ex-mode': (c) =>
    `Cross-examination: ${crossExModeLabel[c.from]} → ${crossExModeLabel[c.to]}`,
  interruptions: (c) =>
    `Interruptions: ${interruptions(c.from)} → ${interruptions(c.to)}`,
  yield: (c) => `Ending a speech early: ${onOff(c.from)} → ${onOff(c.to)}`,
  'resolution-draw': (c) =>
    `Resolution strike: ${strikeOrOff(c.from)} → ${strikeOrOff(c.to)}`,
};

/** One line of the Custom card: what changed from the room's basis, before → after. */
export function formatChangeLine(change: FormatChange): string {
  return (lines[change.kind] as (change: FormatChange) => string)(change);
}
