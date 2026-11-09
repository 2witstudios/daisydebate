import { and, eq, sql } from 'drizzle-orm';
import { createAppError, createRefusal } from '@daisy/errors';
import { idSchema, isSpokenPrefix, spokenPrefix } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { advanceTranscriptRevision } from './capture-history';
import { appendTranscriptChanged } from './transcript-signal';
import { lockRoundAgentContext } from './round-agent-runs';
import { requireAgentLeaseToken } from './round-agent-lease';
import { refuseFinalSpeech } from './bot-generation-rules';
import {
  botSegmentDueAt,
  requireBotSpeakingWindow,
  requireClaimScope,
  verifyLockedBotWorker,
  type BotPublicationScope,
} from './bot-publication-context';
import { roundBotPublications } from './schema/round-bot-publications';
import { roundSegments } from './schema/round-segments';
import { requireTranscriptUnfrozen } from './transcript-unfrozen';
import { transcriptSegments } from './schema/transcript-segments';
import { utterances } from './schema/utterances';

/** One phrase a bot is about to say: its own words and its known length. */
export type BotPhrase = {
  readonly phraseId: string;
  readonly text: string;
  readonly durationMs: number;
  /**
   * How long until its audio starts: a phrase's line is written while the
   * one before it still plays, so it is written before any of its own audio.
   */
  readonly startsInMs?: number;
};
/** How a started phrase ended: played whole, or cut with only `spoken` heard. */
export type BotPhraseEnd =
  | { readonly kind: 'whole' }
  | { readonly kind: 'cut'; readonly spoken: string };

const MAX_PHRASE_MS = 60_000;
function requirePhrase(phrase: BotPhrase) {
  if (
    !idSchema.safeParse(phrase.phraseId).success ||
    typeof phrase.text !== 'string' ||
    !phrase.text.trim() ||
    phrase.text.length > 4000 ||
    !Number.isSafeInteger(phrase.durationMs) ||
    phrase.durationMs <= 0 ||
    phrase.durationMs > MAX_PHRASE_MS ||
    !Number.isSafeInteger(phrase.startsInMs ?? 0) ||
    (phrase.startsInMs ?? 0) < 0 ||
    (phrase.startsInMs ?? 0) > MAX_PHRASE_MS
  )
    throw createAppError('VALIDATION');
}
async function phraseRow(tx: BoundedTransactionContext, phraseId: string) {
  const [row] = await tx
    .select()
    .from(utterances)
    .where(eq(utterances.botPhraseId, phraseId))
    .for('update');
  return row;
}
const sameSeat = (
  row: typeof utterances.$inferSelect,
  scope: BotPublicationScope,
) =>
  row.roundId === scope.roundId &&
  row.segmentId === scope.segmentId &&
  row.roundParticipantId === scope.roundParticipantId;
async function signalChange(tx: BoundedTransactionContext, roundId: string) {
  const revision = await advanceTranscriptRevision(tx, roundId);
  await appendTranscriptChanged(tx, roundId, revision);
}

/**
 * Starts one authored phrase (ADR 0122), in one transaction: the live claim,
 * its room, an open floor in the live segment with no incident, an unfrozen
 * transcript, and a phrase that ends on the database clock before its
 * segment is due. Its utterance is written then, still arriving, with the
 * transcript doorbell. An exact retry, under the same checks, writes nothing; a different body under
 * the same phrase id is refused. A phrase that would end past its segment is
 * a final refusal: the speech stops at its last whole phrase.
 */
export async function beginLockedBotPhrase(
  tx: BoundedTransactionContext,
  input: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly phrase: BotPhrase;
    /** The vendor room the publisher joined; a retired one hears nobody (ADR 0110). */
    readonly room: string;
    readonly nextId: () => string;
  },
) {
  const { scope, phrase } = input;
  requirePhrase(phrase);
  await verifyLockedBotWorker(tx, scope, input.token);
  // Every start, an exact retry included, needs the room, floor and transcript:
  // a retry's audio must not play on authority the first start had.
  const named = await tx.execute(
    sql`select 1 from media_sessions where round_id=${scope.roundId} and room_name=${input.room} limit 1`,
  );
  if (named.length !== 1) throw createRefusal('CONFLICT', 'bot-room-changed');
  await requireBotSpeakingWindow(tx, scope);
  await requireTranscriptUnfrozen(tx, scope.roundId);
  const existing = await phraseRow(tx, phrase.phraseId);
  if (existing) {
    if (!sameSeat(existing, scope) || existing.text !== phrase.text)
      throw createAppError('CONFLICT', 'Conflicting bot phrase retry');
    return {
      duplicate: true,
      segmentDueAt: await botSegmentDueAt(tx, scope),
    };
  }
  // Orders sequence allocation against every other writer of this segment.
  const [fits] = await tx
    .select({
      fits: sql<boolean>`clock_timestamp()+${(phrase.startsInMs ?? 0) + phrase.durationMs}*interval '1 millisecond'<=least(coalesce(${roundSegments.endedAt},'infinity'::timestamptz),${roundSegments.dueAt})`,
    })
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.id, scope.segmentId),
        eq(roundSegments.roundId, scope.roundId),
      ),
    )
    .for('update');
  if (!fits) throw createAppError('CONFLICT');
  if (!fits.fits)
    throw refuseFinalSpeech('Bot phrase would end past its segment');
  const id = input.nextId();
  if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  await tx.insert(utterances).values({
    id,
    roundId: scope.roundId,
    segmentId: scope.segmentId,
    roundParticipantId: scope.roundParticipantId,
    sequence: sql`(select coalesce(max(${utterances.sequence})+1,0) from ${utterances} where ${utterances.segmentId}=${scope.segmentId})`,
    text: phrase.text,
    complete: false,
    botPhraseId: phrase.phraseId,
    botDurationMs: phrase.durationMs,
    // When its audio starts: a line written ahead is dated by its playout.
    createdAt: sql`clock_timestamp()+${phrase.startsInMs ?? 0}*interval '1 millisecond'`,
  });
  // The bot's stream is complete by construction once it has spoken.
  await tx
    .insert(transcriptSegments)
    .values({
      roundId: scope.roundId,
      segmentId: scope.segmentId,
      roundParticipantId: scope.roundParticipantId,
      state: 'complete',
      chunkCount: 0,
      sealedChunkCount: 0,
      sealedAt: sql`clock_timestamp()`,
    })
    .onConflictDoNothing();
  await signalChange(tx, scope.roundId);
  return { duplicate: false, segmentDueAt: await botSegmentDueAt(tx, scope) };
}

/**
 * Ends a started phrase: complete when it played whole, or interrupted with
 * only the words heard when it was cut, never words it did not say. It
 * authenticates the claim's own token even after its lease lapsed, so a stop
 * that races expiry still marks the cut. The first end stands; a later one
 * changes nothing, as does an end for a line already deleted unheard.
 */
export async function endLockedBotPhrase(
  tx: BoundedTransactionContext,
  input: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly phraseId: string;
    readonly end: BotPhraseEnd;
  },
) {
  const { scope, end } = input;
  if (
    !idSchema.safeParse(input.phraseId).success ||
    (end.kind !== 'whole' &&
      (end.kind !== 'cut' || typeof end.spoken !== 'string'))
  )
    throw createAppError('VALIDATION');
  await lockRoundAgentContext(tx, scope.roundId, scope.roundParticipantId);
  const [claim] = await tx
    .select()
    .from(roundBotPublications)
    .where(
      and(
        eq(roundBotPublications.roundId, scope.roundId),
        eq(roundBotPublications.roundParticipantId, scope.roundParticipantId),
      ),
    )
    .for('update');
  requireClaimScope(claim, scope);
  requireAgentLeaseToken(input.token, claim.leaseTokenDigest);
  const row = await phraseRow(tx, input.phraseId);
  if (row && !sameSeat(row, scope)) throw createAppError('NOT_FOUND');
  // Closed already, by this worker, a takeover or the freeze; or cut before a word.
  if (!row || row.complete) return { changed: false };
  await requireTranscriptUnfrozen(tx, scope.roundId);
  if (end.kind === 'whole') {
    await tx
      .update(utterances)
      .set({ complete: true })
      .where(eq(utterances.id, row.id));
  } else {
    const spoken = end.spoken.trim().split(/\s+/).filter(Boolean).join(' ');
    if (!isSpokenPrefix(row.text, spoken)) throw createAppError('VALIDATION');
    await closeLine(tx, row.id, spoken, true);
  }
  await signalChange(tx, scope.roundId);
  return { changed: true };
}
/** A cut line keeps the words heard; one cut before any word was said nothing. */
async function closeLine(
  tx: BoundedTransactionContext,
  id: string,
  spoken: string,
  interrupted: boolean,
) {
  if (!spoken) await tx.delete(utterances).where(eq(utterances.id, id));
  else
    await tx
      .update(utterances)
      .set({ complete: true, interrupted, text: spoken })
      .where(eq(utterances.id, id));
}

/**
 * Closes authored lines their worker never closed (a lost worker, a takeover):
 * each keeps only the words that could have played by now, by its known
 * length and its segment's end, so no unfinished line is frozen whole.
 * Call within the Round's lock, before a takeover's new claim or the freeze.
 */
export async function closeAbandonedBotLines(
  tx: BoundedTransactionContext,
  roundId: string,
  roundParticipantId?: string,
) {
  const rows = (await tx.execute(sql`select u.id, u.text,
      extract(epoch from (least(clock_timestamp(),
        u.created_at+u.bot_duration_ms*interval '1 millisecond',
        coalesce(s.ended_at,'infinity'::timestamptz), s.due_at)-u.created_at))*1000
        / u.bot_duration_ms as fraction
    from utterances u join round_segments s on s.id=u.segment_id and s.round_id=u.round_id
    where u.round_id=${roundId} and u.bot_phrase_id is not null and not u.complete
      ${roundParticipantId === undefined ? sql`` : sql`and u.round_participant_id=${roundParticipantId}`}
    for update of u`)) as unknown as {
    id: string;
    text: string;
    fraction: number | string;
  }[];
  for (const row of rows) {
    const fraction = Number(row.fraction);
    await closeLine(
      tx,
      row.id,
      spokenPrefix(row.text, fraction),
      !(fraction >= 1),
    );
  }
  if (rows.length) await signalChange(tx, roundId);
  return rows.length;
}
