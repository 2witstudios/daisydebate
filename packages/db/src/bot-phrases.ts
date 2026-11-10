import { and, eq, sql, type SQL } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema, isSpokenPrefix, spokenPrefix } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { advanceTranscriptRevision } from './capture-history';
import { appendTranscriptChanged } from './transcript-signal';
import { lockRoundAgentContext } from './round-agent-runs';
import { requireAgentLeaseToken } from './round-agent-lease';
import { refuseFinalSpeech } from './bot-generation-rules';
import {
  requireBotRoom,
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
  /** How long until its audio starts: it may be asked for a phrase ahead. */
  readonly startsInMs?: number;
  /**
   * When its audio starts on the database clock, fixed by the worker when it
   * asks; never before now, and within a phrase and its queue ahead.
   */
  readonly startsAt?: string;
};
/** How a said phrase ended: played whole, or cut with only `spoken` heard. */
export type BotPhraseEnd =
  | { readonly kind: 'whole' }
  | {
      readonly kind: 'cut';
      readonly spoken: string;
      /** How long it played: the line's length is what was heard. */
      readonly playedMs?: number;
    };

const MAX_PHRASE_MS = 60_000;
/** How far a start may be fixed past one whole phrase: the queue ahead of it. */
const MAX_AHEAD_SLACK_MS = 1_000;
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
    (phrase.startsInMs ?? 0) > MAX_PHRASE_MS + MAX_AHEAD_SLACK_MS ||
    (phrase.startsAt !== undefined &&
      !Number.isFinite(Date.parse(phrase.startsAt)))
  )
    throw createAppError('VALIDATION');
}
/** When the phrase's audio starts on the database clock: never before now. */
const startOf = (phrase: BotPhrase) =>
  phrase.startsAt === undefined
    ? sql`clock_timestamp()+${phrase.startsInMs ?? 0}*interval '1 millisecond'`
    : sql`greatest(clock_timestamp(),${new Date(phrase.startsAt)}::timestamptz)`;
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
/** The live claim, its room, an open floor with no incident, an open transcript. */
async function requirePhraseAuthority(
  tx: BoundedTransactionContext,
  scope: BotPublicationScope,
  token: string,
  room: string,
) {
  await verifyLockedBotWorker(tx, scope, token);
  await requireBotRoom(tx, scope, room);
  await requireBotSpeakingWindow(tx, scope);
  await requireTranscriptUnfrozen(tx, scope.roundId);
}
/**
 * The phrase, its audio starting at `start`, ends before its segment is due
 * and starts within a phrase and its queue ahead. A phrase past its segment is
 * a final refusal: the speech stops at its last whole phrase. Returns the
 * start it checked, read once.
 */
async function requirePhraseFits(
  tx: BoundedTransactionContext,
  scope: BotPublicationScope,
  phrase: BotPhrase,
  start: SQL,
  lock: boolean,
) {
  const query = tx
    .select({
      start: sql<Date | string>`${start}`,
      fits: sql<boolean>`${start}+${phrase.durationMs}*interval '1 millisecond'<=least(coalesce(${roundSegments.endedAt},'infinity'::timestamptz),${roundSegments.dueAt})`,
      ahead: sql<boolean>`${start}<=clock_timestamp()+${MAX_PHRASE_MS + MAX_AHEAD_SLACK_MS}*interval '1 millisecond'`,
    })
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.id, scope.segmentId),
        eq(roundSegments.roundId, scope.roundId),
      ),
    );
  const [fit] = lock ? await query.for('update') : await query;
  if (!fit) throw createAppError('CONFLICT');
  if (!fit.ahead) throw createAppError('VALIDATION');
  if (!fit.fits)
    throw refuseFinalSpeech('Bot phrase would end past its segment');
  return new Date(fit.start);
}
/** An existing line for the phrase id: the same phrase, or a conflicting retry. */
async function saidLine(
  tx: BoundedTransactionContext,
  scope: BotPublicationScope,
  phrase: BotPhrase,
) {
  const existing = await phraseRow(tx, phrase.phraseId);
  if (existing && (!sameSeat(existing, scope) || existing.text !== phrase.text))
    throw createAppError('CONFLICT', 'Conflicting bot phrase retry');
  return existing;
}

/**
 * Authorizes a phrase before any of its audio plays (ADR 0122): the live
 * claim, its vendor room, an open floor in the live segment with no incident,
 * an open transcript, and a phrase that ends on the database clock before its
 * segment is due, counting the wait until its audio starts. It writes
 * nothing: a phrase is written only as it is said, by its reveal. A phrase
 * that would end past its segment is a final refusal: the speech stops at
 * its last whole phrase.
 */
export async function authorizeLockedBotPhrase(
  tx: BoundedTransactionContext,
  input: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly phrase: BotPhrase;
    readonly room: string;
  },
) {
  const { scope, phrase } = input;
  requirePhrase(phrase);
  await requirePhraseAuthority(tx, scope, input.token, input.room);
  await requirePhraseFits(tx, scope, phrase, startOf(phrase), false);
  // A different body under a phrase id already said is refused before any audio.
  await saidLine(tx, scope, phrase);
}

/**
 * Writes a phrase's line as its audio starts (ADR 0122): one transaction,
 * beside the audio, that checks the claim, its room and the floor again at the
 * moment the phrase is heard, and that it ends before its segment is due,
 * counting from its audio start. It writes the line still arriving, dated at
 * that start (never later than now), with its stream and the transcript
 * doorbell. Only said lines are ever written, so every reader reads only said
 * lines. A refusal stops the audio. An exact retry writes nothing twice.
 */
export async function revealLockedBotPhrase(
  tx: BoundedTransactionContext,
  input: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly phrase: BotPhrase;
    readonly room: string;
    /** When its audio started on the database clock, as the worker read it. */
    readonly startedAt?: string;
    readonly nextId: () => string;
  },
) {
  const { scope, phrase } = input;
  requirePhrase(phrase);
  if (
    input.startedAt !== undefined &&
    !Number.isFinite(Date.parse(input.startedAt))
  )
    throw createAppError('VALIDATION');
  await requirePhraseAuthority(tx, scope, input.token, input.room);
  // An exact retry of a reveal that landed writes nothing, however late.
  if (await saidLine(tx, scope, phrase)) return { revealed: false };
  // Fenced like its authorization, from its audio start as the worker read it
  // (never later than now, nor before its segment started); the lock orders
  // sequence allocation against every other writer of this segment.
  const audioStart = await requirePhraseFits(
    tx,
    scope,
    phrase,
    input.startedAt === undefined
      ? sql`clock_timestamp()`
      : sql`greatest(least(clock_timestamp(),${new Date(input.startedAt)}::timestamptz),${roundSegments.startedAt})`,
    true,
  );
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
    // Dated at its audio start, but never more than a whole phrase ago.
    createdAt: sql`greatest(${audioStart}::timestamptz,clock_timestamp()-${phrase.durationMs}*interval '1 millisecond')`,
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
  return { revealed: true };
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
    await closeLine(tx, row, spoken, true, end.playedMs);
  }
  await signalChange(tx, scope.roundId);
  return { changed: true };
}
type LineRow = {
  readonly id: string;
  readonly roundId: string;
  readonly segmentId: string;
  readonly roundParticipantId: string;
};
/**
 * A cut line keeps the words heard; one cut before any word said nothing and
 * is deleted. A bot's stream is complete only because it spoke, so a stream
 * left with no line is dropped with it: its turn stays owed (ADR 0122).
 */
async function closeLine(
  tx: BoundedTransactionContext,
  row: LineRow,
  spoken: string,
  interrupted: boolean,
  /** How long it played, when known: a cut line's length is what was heard. */
  playedMs?: number,
) {
  if (spoken) {
    const heard =
      interrupted && playedMs !== undefined && Number.isFinite(playedMs)
        ? Math.min(MAX_PHRASE_MS, Math.max(1, Math.round(playedMs)))
        : undefined;
    await tx
      .update(utterances)
      .set({
        complete: true,
        interrupted,
        text: spoken,
        ...(heard === undefined ? {} : { botDurationMs: heard }),
      })
      .where(eq(utterances.id, row.id));
    return;
  }
  await tx.delete(utterances).where(eq(utterances.id, row.id));
  await tx.execute(sql`delete from transcript_segments t
    where t.round_id=${row.roundId} and t.segment_id=${row.segmentId}
      and t.round_participant_id=${row.roundParticipantId} and t.chunk_count=0
      and not exists(select 1 from utterances u where u.round_id=t.round_id
        and u.segment_id=t.segment_id and u.round_participant_id=t.round_participant_id)`);
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
  const rows =
    (await tx.execute(sql`select u.id, u.text, u.round_id as "roundId",
      u.segment_id as "segmentId", u.round_participant_id as "roundParticipantId",
      extract(epoch from (least(clock_timestamp(),
        u.created_at+u.bot_duration_ms*interval '1 millisecond',
        coalesce(s.ended_at,'infinity'::timestamptz), s.due_at)-u.created_at))*1000
        / u.bot_duration_ms as fraction, u.bot_duration_ms as "durationMs"
    from utterances u join round_segments s on s.id=u.segment_id and s.round_id=u.round_id
    where u.round_id=${roundId} and u.bot_phrase_id is not null and not u.complete
      ${roundParticipantId === undefined ? sql`` : sql`and u.round_participant_id=${roundParticipantId}`}
    for update of u`)) as unknown as {
      id: string;
      text: string;
      fraction: number | string;
      durationMs: number;
      roundId: string;
      segmentId: string;
      roundParticipantId: string;
    }[];
  for (const row of rows) {
    const fraction = Number(row.fraction);
    await closeLine(
      tx,
      row,
      spokenPrefix(row.text, fraction),
      !(fraction >= 1),
      // A cut line's length is what could have played.
      fraction * Number(row.durationMs),
    );
  }
  if (rows.length) await signalChange(tx, roundId);
  return rows.length;
}
