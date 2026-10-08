import { createAppError } from '@daisy/errors';
import {
  practiceRoomConfig,
  referenceAiJudge,
} from '@daisy/db/reference-formats';
import { aiSideOf, type AiDebateDependencies } from './context';
import { opponentFor } from './opponents';
import { resolveRoomChoice } from '../debate-room/resolve-room';

const tidy = (resolution: string) => resolution.trim().replace(/\s+/g, ' ');

/**
 * Starts one practice Room: resolves the one-on-one format against the
 * practice config, seats the person, the Train bot and the AI judge, and
 * freezes the Round. The global live ceiling is checked before the personal
 * daily one — `limits.live` bounds what the service can carry at once, and
 * every member's own allowance multiplies out under it.
 */
export const startPractice = async (
  {
    store,
    voice,
    ids,
    limits,
  }: AiDebateDependencies & {
    readonly limits: { readonly live: number; readonly perDay: number };
  },
  input: {
    readonly actorId: string;
    readonly resolution: string;
    readonly personSide: 'affirmative' | 'negative';
    /** The Train bot to debate. */
    readonly opponent: string;
  },
): Promise<{ readonly id: string }> => {
  const trimmed = tidy(input.resolution);
  if (trimmed.length < 3 || trimmed.length > 200)
    throw createAppError('VALIDATION', 'Resolution length');
  const opponent = opponentFor(input.opponent);
  if (!opponent) throw createAppError('VALIDATION', 'Unknown opponent');
  voice(); // refuse before writing anything when AI debates are unavailable
  const now = Date.parse(await store.databaseNow());
  const resolved = await resolveRoomChoice(store, {
    competitionType: 'practice',
    formatId: 'one-on-one',
    length: 'full',
    config: practiceRoomConfig,
  });
  const roomId = ids.next();
  const room = {
    id: roomId,
    ...resolved,
  } as const;
  const seats = [
    { id: ids.next(), actorId: input.actorId, role: input.personSide },
    {
      id: ids.next(),
      actorId: opponent.actorId,
      role: aiSideOf(input.personSide),
    },
    {
      id: ids.next(),
      actorId: referenceAiJudge.actorId,
      role: 'judge' as const,
    },
  ] as const;
  const roundId = ids.next();
  await store.admitAiPractice({
    room,
    seats,
    roundId,
    resolution: trimmed,
    reservationId: ids.next(),
    actorId: input.actorId,
    since: new Date(now - 24 * 60 * 60_000),
    limits,
  });
  return { id: roundId };
};
