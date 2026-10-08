import { formatClock as formatSeconds } from '../judge/clock';

/** A countdown reading: partial seconds round up, so 0:00 means time is up. */
export function formatClock(ms: number): string {
  return formatSeconds(Math.ceil(ms / 1000));
}

export type ClockUrgency = 'normal' | 'low' | 'critical' | 'over';

export function clockUrgency(remainingMs: number): ClockUrgency {
  if (remainingMs <= 0) return 'over';
  if (remainingMs <= 15_000) return 'critical';
  if (remainingMs <= 60_000) return 'low';
  return 'normal';
}

export type EndSpeechState = 'idle' | 'armed' | 'ended';

export function pressEndSpeech(state: EndSpeechState): EndSpeechState {
  return state === 'idle' ? 'armed' : 'ended';
}

export function cancelEndSpeech(state: EndSpeechState): EndSpeechState {
  return state === 'armed' ? 'idle' : state;
}
