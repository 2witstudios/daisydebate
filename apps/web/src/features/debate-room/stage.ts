import { formatCountdown } from '../clock-display/clock-display';
import type { Side, SpeechSlot } from './documents/documents';
import type { RoundPhase } from './layout';
import type { TranscriptSegment } from './transcript';

/** Each debater's part in the phase, shown on their tile; '' for none. */
export type FloorStates = { readonly self: string; readonly opponent: string };

const floor: Readonly<Record<RoundPhase, FloorStates>> = {
  waiting: { self: '', opponent: '' },
  'opponent-speaking': { self: '', opponent: 'Speaking' },
  'cross-ex': { self: 'Asking', opponent: 'Answering' },
  prep: { self: '', opponent: '' },
  'own-speech': { self: 'Speaking', opponent: '' },
  judging: { self: '', opponent: '' },
};

export function floorStates(phase: RoundPhase): FloorStates {
  return floor[phase];
}

/** The speaker layout's large tile is yours only while you speak. */
export function speakerIsSelf(phase: RoundPhase): boolean {
  return phase === 'own-speech';
}

export type UpNextLine = {
  readonly label: 'Next' | 'Then';
  readonly text: string;
};

/** The two steps after the live speech; judging follows the last speech. */
export function upNext(
  speeches: readonly SpeechSlot[],
  liveIndex: number,
  selfSide: Side,
  opponentName: string,
): readonly UpNextLine[] {
  const steps = [
    ...speeches
      .slice(liveIndex + 1)
      .map(
        (slot) =>
          `${slot.code} · ${slot.side === selfSide ? 'You' : opponentName} · ${formatCountdown(slot.durationMs)}`,
      ),
    'Judging',
  ].slice(0, 2);
  return steps.map((text, index) => ({
    label: index === 0 ? 'Next' : 'Then',
    text,
  }));
}

/** The meter's shape at full voice, in height steps of 1–6. */
const meterShape = [3, 5, 4, 6, 3, 5, 2] as const;

/** Each bar's height step for a voice level from 0 (silent) to 1. */
export function voiceBars(level: number): readonly number[] {
  const scale = Math.min(1, Math.max(0, level));
  return meterShape.map((full) => Math.max(1, Math.round(full * scale)));
}

/** The live speech's last two lines, oldest first. */
export function liveCaptions(
  transcript: readonly TranscriptSegment[],
  liveSpeechId: string | null,
): readonly TranscriptSegment[] {
  return transcript
    .filter((segment) => segment.speechId === liveSpeechId)
    .sort((a, b) => a.offsetMs - b.offsetMs)
    .slice(-2);
}
