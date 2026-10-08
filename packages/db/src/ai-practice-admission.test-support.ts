import { practiceRoomConfig } from './reference-formats';
import { validRules } from './testing';
import type { NewRoom } from './room-operations';

/** Complete one-on-one cast rules for both scripted and PostgreSQL admission proof. */
export const aiPracticeRoom = (
  id: string,
  formatId: string,
  formatVersion: number,
): NewRoom => ({
  id,
  formatId,
  formatVersion,
  presetVersion: null,
  competitionType: 'practice',
  length: 'full',
  config: practiceRoomConfig,
  executionPlan: { preRoundPrep: { enabled: false } },
  rules: {
    ...validRules,
    seats: { ...validRules.seats, judge: 1 },
  },
});
