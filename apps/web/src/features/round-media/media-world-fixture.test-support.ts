import {
  oneOnOneDefinition,
  oneOnOneRoomConfig,
} from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
/** Deterministic 24-character identifiers the real media adapter accepts. */
export const fixedId = (label: string) =>
  label
    .replace(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

const compiled = resolveRoomConfiguration(
  oneOnOneDefinition,
  oneOnOneRoomConfig,
);
if (!compiled.ok) throw new Error('Canonical rules fixture refused');
export const rules = compiled.rules;
export const sessionId = fixedId('session');
export const roundId = fixedId('round');
export const seats = [
  {
    id: fixedId('seataff'),
    actorId: fixedId('actoraff'),
    role: 'affirmative',
    slot: 0,
  },
  {
    id: fixedId('seatneg'),
    actorId: fixedId('actorneg'),
    role: 'negative',
    slot: 0,
  },
  {
    id: fixedId('seatjudge'),
    actorId: fixedId('actorjudge'),
    role: 'judge',
    slot: 0,
  },
] as const;
