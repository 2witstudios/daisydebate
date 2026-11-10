# 0122: Authored bot speech

Status: accepted direction, owner-authorized slice authored-bot-speech,
2026-11-09. Supersedes the bot clauses of DEC-212, DEC-213, DEC-215, DEC-218
and DEC-226, and the "generated text never becomes an utterance" clause of
[round bot workers](../architecture/round-bot-workers.md).

## Context

Bot speech in Rounds dropped out like a bad call, and most of each speech
never reached the transcript. The cause was structural:

- the bot's PCM went into LiveKit through an unbuffered native source;
- every 100 ms of audio waited on a locked PostgreSQL transaction that
  credited a publication window, so each database round trip froze the
  stream, two late frames stopped it as a stall, and two stalls ended the
  speech;
- the bot's transcript came only from capture and speech-to-text, so every
  dropout also deleted text;
- each sentence was voiced only after the previous one finished playing.

A bot already knows its words and holds its audio before it plays them. The
owner's direction: author its transcript from its own text, and guarantee
its delivery instead of fitting it into the human capture pipeline.

## Decision

1. **A bot's transcript is authored.** Each phrase becomes one `utterances`
   row written by the bot worker from its generated text, keyed by
   `bot_phrase_id`. A line is either captured (clip key) or authored (phrase
   id), never both. Capture still subscribes to, records and broadcasts a bot
   track, but never transcribes it, and the server refuses any captured clip,
   observation or seal for a bot seat (`bot-authored`).
2. **Authority before the audio, again as it starts.** One transaction per
   phrase verifies the live claim, its vendor room (ADR 0110), an open floor
   in the live segment with no incident, and an unfrozen transcript, an exact
   retry included. It checks that the phrase, whose length is known from its
   samples, ends on the database clock before the segment is due, counting
   from when its audio starts, fixed on the database clock when the worker
   asks (`startsAt`). It writes nothing: for every phrase after the first it
   runs while the phrase before it still plays, so no phrase waits on its
   own start, and a refusal plays nothing. As the phrase's audio starts, its
   **reveal**, beside the audio, checks the claim, room and floor again and
   only then writes the line, still arriving (`complete=false`), dated at
   its audio start (fixed on the database clock, never later than the
   reveal), and rings the transcript doorbell. `utterances` therefore holds
   only lines that were said: no reader filters unsaid ones, a line is read
   exactly from when it is said, and a refused reveal writes nothing and
   stops the audio at once. The bot's own next prompt reads a bot line only
   once it closed; spectators read only closed lines, released once their
   words have all played. While a phrase plays, its floor and room are re-read
   about every 250 ms without a lock, beside the audio, so a lost floor still
   silences the bot at once.
3. **The segment cutoff stays authoritative.** A phrase that cannot finish
   before the segment is due is never started (a final refusal: the speech
   ends at its last whole phrase). The writer also stops locally at the
   segment's due time, calibrated once per speech against the database
   clock, and never hands over a frame whose playout would end past it, so
   neither the queue lead nor clock skew plays audio past the cutoff.
4. **A cut phrase is marked, not invented.** A phrase closes `complete` only
   once its queued tail has played out. One cut short by a barge-in, a
   refusal, a stop or a failed handoff, including one whose tail is cleared
   after its last frame was handed over, closes `interrupted`. Its text keeps
   only the whole words fully played: samples sent less samples still
   queued, never the samples merely sent. A line cut before its first word is
   deleted. The database accepts only a whole-word prefix of the authored
   text. The close authenticates the claim's own token even after its lease
   lapsed, and an end that keeps failing is asked again at the next phrase
   and at the claim's end. A line its worker never closed (a lost worker) is
   closed at the seat's takeover, and at the freeze before it reads its
   streams, to the words that could have played by then, by its known length
   and its segment's end; one closed before any word could play is deleted.
5. **Guaranteed delivery.** The bot still publishes into LiveKit, so people,
   recording and broadcast hear it with no new client path. The native
   source has a 500 ms queue; the writer hands 10 ms frames over 300 ms ahead
   of playout on a monotonic clock and awaits nothing but the handoff, so
   timer or collection jitter cannot drain it. An abort clears the queue at
   once.
6. **No gaps between sentences, and no voiced phrase without a line.**
   Nothing stands between one phrase's last frame and the next phrase's
   first except that next phrase's own authorization, asked a whole phrase
   earlier: line closes are never awaited, and a start slower than the phrase
   before it is the only wait. A start that fails for a reason a retry can
   clear is asked again, up to three times, under the same line id. A start
   refused, or still failing, plays none of its phrase; the speech stays on
   that phrase, the last one included, and says it under the same line id
   once it is authorized. A phrase authorized ahead whose audio then never
   starts (a barge-in, a stop, the segment's end) wrote nothing, so nothing
   is withdrawn. A reveal that fails stops the audio, and the phrase is said
   again; an exact repeat of a reveal writes nothing twice. The next two phrases are voiced alongside the
   current one, since a long phrase can take longer to voice than a short
   one before it plays; each is bought and settled once and kept across
   retries, a voice-ahead refused a pool slot is asked again as soon as another voice
   is bought, a
   first phrase shorter than 4 s waits for the second to be voiced so the
   speech never stalls after its opening words,
   and once the speech is over (its end, a final refusal, its last attempt or
   a stop) voicing ahead is aborted. A retry keeps its line id until that line
   is closed; a phrase cut and closed is said again whole, as a new line.
7. **Coverage.** A bot's stream is complete by construction once it authors
   a line, and dropped again if its only line is cut before its first word. A grant it did not use owes nothing (ISSUE-965, now read from
   authored speech). Its scheduled turn with no authored line still freezes
   incomplete (`never-sealed`): a silent bot is a failure, not "nothing
   lost". Credited publication windows, their table and the bot branches of
   the coverage tolerances (terminal zone, coalescing, relay edges) are
   removed.
8. **One transcript.** Judges, round analysis, the live and history
   transcript, and the bot's own next prompt read the same lines; a cut line
   carries `interrupted`, and the judge is told to judge it as said and never
   complete it.

## Consequences

- `PublicationStop` is `connect | handoff`; `stall`, `clock`, `refused` and
  `unheard` no longer exist, and the speech's two attempts cover only
  provider and connection failures.
- The capture-heard key no longer gates bot speech; it stays for the Round
  start gate and held-Round resume.
- `@daisy/media/publication` is the streaming writer. The paced writer,
  publication observation and the receipt half of the publication clock are
  deleted; `frame-clock` keeps the calibration it shares.
- Every transcript line carries `interrupted`; an open tab reads through
  the added field, and a new tab reading an older server defaults it to
  false, so the transcript read contract keeps version 1.
- Product intent "speak only through heard, captured audio" (DEC-226) now
  reads "speak with authored transcripts and guaranteed delivery".
