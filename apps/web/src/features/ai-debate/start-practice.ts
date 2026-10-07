import { resolveRoomConfiguration as resolveRoom } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import {
  practiceRoomConfig,
  referenceAiJudge,
} from '@daisy/db/reference-formats';
import { aiSideOf, type AiDebateDependencies } from './context';
import { opponentFor } from './opponents';

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
  const live = await store.countLiveRounds();
  if (live >= limits.live)
    throw createAppError('RATE_LIMIT', 'Too many live AI debates');
  const recent = await store.countRecentAiPractice({
    actorId: input.actorId,
    since: new Date(now - 24 * 60 * 60_000),
  });
  if (recent >= limits.perDay)
    throw createAppError('RATE_LIMIT', 'Daily AI debate limit');
  const format = await store.getFormat('one-on-one');
  if (!format) throw createAppError('INFRASTRUCTURE', 'The format is missing');
  const resolved = resolveRoom(format.definition, practiceRoomConfig);
  if (!resolved.ok)
    throw createAppError(
      'INFRASTRUCTURE',
      `The practice room refuses to resolve: ${resolved.refusal.message}`,
    );
  const roomId = ids.next();
  await store.createRoom({
    id: roomId,
    formatId: format.id,
    formatVersion: format.version,
    presetVersion: null,
    competitionType: 'practice',
    length: 'full',
    config: practiceRoomConfig,
    executionPlan: resolved.roomPlan,
    rules: resolved.rules,
  });
  await store.seatRoomParticipant({
    roomId,
    participantId: ids.next(),
    actorId: input.actorId,
    role: input.personSide,
    slot: 0,
  });
  await store.seatRoomParticipant({
    roomId,
    participantId: ids.next(),
    actorId: opponent.actorId,
    role: aiSideOf(input.personSide),
    slot: 0,
  });
  await store.seatRoomParticipant({
    roomId,
    participantId: ids.next(),
    actorId: referenceAiJudge.actorId,
    role: 'judge',
    slot: 0,
  });
  const roundId = ids.next();
  await store.startRound({ roomId, roundId, resolution: trimmed });
  await store.reserveAiPractice({
    id: ids.next(),
    actorId: input.actorId,
    roundId,
  });
  return { id: roundId };
};
