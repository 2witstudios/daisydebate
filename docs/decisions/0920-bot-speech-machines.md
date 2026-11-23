# 0920: The bot publisher is one step function; the speaker decides from its speech state

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
step R4.3; decided for the owner by the reconcile point guard under the
2026-11-23 delegation). Amends [ADR 0122](0122-authored-bot-speech.md)
§"Publication and speech models" and [ADR 0164](0164-property-tests-and-virtual-time.md)
(the bot gets a corpus and walks of its own).

## Context

Measured at `bfb17fa8d`, 23 November 2026:

- `round-bots/publication.ts` was 724 lines: one factory (`createBotPublisher`,
  165–724) whose closure held about a dozen variables beside the pure line
  ledger and schedule (`room`, `roomLeft`, `closing`, `aheadJobs`,
  `dbOffsetMs`, `prepared`, `endingJobs`, `retrying` and more). `play`
  (about 230 lines) interleaved the reveal, the floor watch and the frame
  writer, and decided what starts, what is cut, the end fraction, the stop
  and every retry inside its awaits.
- `round-bots/speaker.ts` (559 lines) interpreted the pure speech state's
  directives but also decided from records of its own: which voices it held
  (`goods.voices.has`), the speech's deadline (a loop local), whether a voice
  bought for an older answer still counted (object identity), whether
  voicing ahead had closed (an abort signal), and how a failure maps onto the
  duty.
- About 7,600 test lines; the 2026-11-19 audit judged 20 of 26 round-bots
  unit files to pin implementation. ADR 0911 had just made the round engine
  one pure step returning state, changes and effects.

## Decision

1. **`stepPublisher(state, event)` is the publisher**
   (`round-bots/model/publisher.ts`). State is one value: the claim and its
   drain, the track, the room, the database clock offset, the line ledger
   and the authorization schedule (both kept, the ledger now holding each
   line's end as asked), the authorizations, the store calls in flight with
   their attempts, the phrase in play and its stage (joining, authorizing,
   writing, revealing, ending), and the closing chain. An event is anything
   that happened (publish, stop, write ahead, silence, discard, close, a
   join landing or failing, a call answered or refused, a wait elapsing, the
   writer ending), read beside the track's time, queue and health. Effects
   are data: join, leave, call (begin, reveal, end, floor read), write frames
   up to a stop, stop writing, clear the queue, wait until, cancel a wait,
   resume, answer the publish, closed. Every decision `play` made is in the
   step: what starts, what is cut and where, the end fraction (AMEND-1), the
   hard stop, which calls are asked again, their limit and their pause, and
   how the claim drains before it leaves.
2. **`publication.ts` is the interpreter** (227 lines, no function over 60).
   It holds the step's state, the native tracks, the audio of the phrase in
   play, the pending waits and the answer of the publish in flight: no
   decision reads them. `publication-io.ts` performs effects and decides
   nothing: the store calls, joining a room on a fresh track (ADR 0110), and
   streaming one phrase through `@daisy/media/publication`'s writer. The
   writer stays a mechanism (cadence, lead, underrun, and its own guard that
   no frame plays past the stop it is given); the step decides that stop.
   It runs on injected time, so a virtual clock drives it in tests.
3. **The speech state is the speaker's only record.** `speaker.ts` keeps its
   async loop as the interpreter of `nextSpeechWork`, but every branch it
   takes reads the state: `hasVoice`, `needsLine`, `tailWasCut`, `stopAt`
   (the hard stop, read once per turn into the run), the generation instead
   of object identity, the voicing status instead of an abort signal, and
   `setbackOf` for what a failed turn means for the duty. What it holds are
   resources only: the paid answers, the calls in flight, the turn's abort,
   the floor waiters and the self-wake timers.
4. **Two machines, not one** (the audit's open question, line 111). The
   publisher is per claim and per audio track: lines, room, retries and the
   drain at the claim's end. The speaker is per duty: turns, peers and
   purchases. No decision needs both states at once: the speaker reads the
   publisher only through two pure queries of its ledger (`lineClosed`,
   `tailCut`) and whether audio is still queued, and asks it through one
   publish, one write-ahead and a silence. Merging them would couple paid
   receipts to audio-track state for no decision that reads both, and would
   make either machine's walks drive the other's I/O. The seam is now one
   typed input (`publication`) instead of eight wired functions.
5. **The bot has a net at its edge.** The bot corpus
   (`round-bots/bot-corpus*.ts`, 166 logs under `round-bots/corpus/`) drives
   the real speaker wired to the real publisher on a virtual clock over stubs
   for the store, the native track, the language answer and the voice, and
   logs every call across that edge with its virtual instant. Its named
   rounds restate the scenarios of the publisher's and speaker's unit tests
   as they stood at `bfb17fa8d`; 80 more are generated from fixed seeds. It
   was recorded on the old code and the rewrite reproduces it byte for byte.
   Within one instant the log lists the speaker's calls, then the
   publisher's, then the frames, each in its own order: which of two
   independent calls in one instant runs first is a matter of promise turns,
   not behaviour, and the causal order that ordering hid is a walk property
   instead.
6. **Properties are generated walks** (`round-bots/bot-walks.test.ts`, three
   fixed seeds, 40 walks each, over the same harness). Publisher: audio only
   after its start was granted; every revealed line ends exactly once; no
   end credits more than was handed over; no frame plays past its stop;
   nothing begins after the claim ends. Speaker: each phrase voiced once per
   answer unless it failed; lines in order; one answer per turn (with
   replayed end-of-turn reports); quiet while a peer is mid-turn in
   cross-examination; nothing bought or said once over; timed waits wake the
   speaker by themselves; no wait outlives the claim. `bun bots:sabotage`
   applies named mutations in a scratch worktree and prints which net
   (unit tests, corpus, walks) catches each.

## Consequences

- ADR 0122's "Publication and speech models" now reads: the publisher is
  one pure step over its line ledger and authorization schedule, returning
  effects as data, and its shell only performs them; the speech state is the
  speaker's only record. The rest of ADR 0122 stands.
- The tests that drove the old closure through its internal seams are
  deleted (the publisher's suite, nine speaker suites and their harness, the
  ledger's and schedule's suites); the corpus and the walks cover them.
- The explicit machine is longer than the closure it replaces: state the
  closure kept in its awaits is now named. round-bots non-test code went
  from 4,396 to about 4,970 lines; its tests from 8,088 to about 5,950.
- A change to what the bot sends across its edge shows as a corpus diff;
  `GOLDEN_UPDATE=1` rewrites the logs, and a PR that does so lists each
  changed log and why.
