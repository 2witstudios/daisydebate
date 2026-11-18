import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
/** Historical identities remain stored; only the current judge assignment grants live seat authority. */
export const currentRoundParticipant = (participantId: AnyPgColumn) =>
  sql<boolean>`public.daisy_round_participant_is_current(${participantId})`;
