import type { AiDebateCommand } from './ai-debate';

const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);

/** `seconds` after the debate's fixed start. */
export const s = (seconds: number) => T0 + seconds * 1000;

export const start: AiDebateCommand = { type: 'start', at: T0 };
