import type { FormatChange } from '@daisy/protocol';
import { crossExModeLabel, interruptionLabel } from '../debate-room/vocabulary';
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

/** One line of the Custom card: what changed from the room's basis, before → after. */
export function formatChangeLine(change: FormatChange): string {
  switch (change.kind) {
    case 'seats':
      return `${roleLabel[change.role]} ${change.from} → ${change.to}`;
    case 'segments':
      return `Speeches ${[
        change.added.length ? `added ${change.added.join(', ')}` : null,
        change.removed.length ? `removed ${change.removed.join(', ')}` : null,
        change.changed.length ? `changed ${change.changed.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}`;
    case 'segment-duration':
      return `${change.key} ${clockDuration(change.fromMs)} → ${clockDuration(change.toMs)}`;
    case 'countdown':
      return `Countdown ${clockDuration(change.fromMs)} → ${clockDuration(change.toMs)}`;
    case 'in-round-prep':
      return `Prep per side ${clockOrOff(change.fromMs)} → ${clockOrOff(change.toMs)}`;
    case 'pre-round-prep':
      return `Prep before the round ${clockOrOff(change.fromMs)} → ${clockOrOff(change.toMs)}`;
    case 'cross-ex-mode':
      return `Cross-examination: ${crossExModeLabel[change.from]} → ${crossExModeLabel[change.to]}`;
    case 'interruptions':
      return `Interruptions: ${interruptions(change.from)} → ${interruptions(change.to)}`;
    case 'yield':
      return `Ending a speech early: ${onOff(change.from)} → ${onOff(change.to)}`;
  }
}
