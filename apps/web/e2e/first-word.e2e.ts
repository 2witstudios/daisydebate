import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { oneOnOneSettings } from '@daisy/db/reference-formats';
import { roundTranscriptReadSchema } from '@daisy/protocol';
import type { Page } from '@playwright/test';
import {
  ballotRoundCommand,
  readBallotRound,
} from './support/human-ballot-round';
import { oneOnOneChoice } from './support/human-round-selection';
import { drillEvidence } from './support/node-kill-drill-evidence';
import { expect, openPage, test } from './support/fixtures';
import { nowMs } from './support/node-kill-drill-nodes';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { expectConnected, grantedDebaters } from './support/round-media';

/**
 * Whether a person loses a word at a floor change (ISSUE-1301). A real browser seat starts
 * real speech the moment that speaker's own page shows the clock running, on the catalog
 * format, and the stored transcript is read for the first word. It needs a real
 * OPENROUTER_API_KEY and macOS `say`: bun drill:first-word.
 */
const OPENING_WORDS: Readonly<Record<string, string>> = {
  AC: 'Apple',
  CX1: 'Bicycle',
  NC: 'Copper',
  CX2: 'Dolphin',
  '1AR': 'Elephant',
  NR: 'Falcon',
  '2AR': 'Giraffe',
};
/**
 * How long after their clock shows a speaker starts. Zero is the worst case. 300 ms is a
 * quick person's reaction to a visual cue, before any speech planning. 1500 ms is the
 * control: past every loss seen, so a wrong word there is the model mishearing this audio.
 */
const ALL_CASES: readonly {
  readonly name: string;
  readonly reactionMs: number;
  /** How a speech leaves prep: the seat's button, or prep running out. */
  readonly prep?: 'button' | 'ran-out';
}[] = [
  { name: 'zero', reactionMs: 0 },
  { name: 'zero', reactionMs: 0 },
  { name: 'realistic', reactionMs: 300 },
  { name: 'realistic', reactionMs: 300 },
  { name: 'control', reactionMs: 1500 },
  { name: 'prep-button-zero', reactionMs: 0, prep: 'button' },
  { name: 'prep-button-realistic', reactionMs: 300, prep: 'button' },
  { name: 'prep-ran-out-realistic', reactionMs: 300, prep: 'ran-out' },
];
/** FIRST_WORD_CASES=prep runs only the cases whose name starts with it. */
const CASES = ALL_CASES.filter(({ name }) =>
  name.startsWith(process.env.FIRST_WORD_CASES ?? ''),
);
/** The speeches each prep case prepares for: one per side, since a side's budget is spent. */
const PREPARED: Readonly<Record<'button' | 'ran-out', readonly string[]>> = {
  button: ['1AR', 'NR', '2AR'],
  'ran-out': ['1AR'],
};
const PREP_BEFORE_BUTTON_MS = 3_000;
const HOLD_SPEECH_MS = 11_000;
const PLAY_OUT_LIMIT_MS = 420_000;
const RESULTS = resolve(import.meta.dirname, '../test-results/first-word');

const pause = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });
const spoken = async (word: string) => {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-first-word-'));
  const path = join(dir, 'speech.wav');
  execFileSync('say', [
    '-o',
    path,
    '--data-format=LEI16@24000',
    `${word} is the first word of this speech, and after it I go on talking in plain sentences about public transit funding in our cities.`,
  ]);
  return (await readFile(path)).toString('base64');
};

type Line = {
  readonly key: string;
  readonly shows: string;
  readonly wav: string;
};

/** What the speaker's own clock reads once their segment's clock runs. */
const clockLabel = (segment: { type: string; key: string; label: string }) =>
  segment.type === 'cross_ex'
    ? 'Cross-examination · You ask'
    : `${segment.key} · ${segment.label}`;

/**
 * The seat's microphone plays each of its lines when its own clock shows that label. It
 * unmutes the moment that is offered, as a seat in a format with open questioning starts
 * muted.
 */
const installSpeaker = (
  page: Page,
  lines: readonly Line[],
  reactionMs: number,
) =>
  page.addInitScript(
    ({ given, reaction }: { given: readonly Line[]; reaction: number }) => {
      const onsets: Record<string, number> = {};
      Object.assign(window, { firstWordOnsets: onsets });
      const native = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      const audio = new AudioContext();
      const output = audio.createMediaStreamDestination();
      const buffers = new Map<string, Promise<AudioBuffer>>(
        given.map(({ key, wav }) => [
          key,
          audio.decodeAudioData(
            Uint8Array.from(atob(wav), (c) => c.charCodeAt(0)).buffer,
          ),
        ]),
      );
      const reacted = new Set<string>();
      const speak = async (key: string) => {
        if (reacted.has(key)) return;
        reacted.add(key);
        const buffer = await buffers.get(key);
        if (!buffer) return;
        await new Promise((done) => {
          setTimeout(done, reaction);
        });
        onsets[key] = performance.timeOrigin + performance.now();
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(output);
        source.start();
      };
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await native(constraints);
        if (!constraints?.audio || !location.pathname.startsWith('/rounds/'))
          return stream;
        await audio.resume();
        for (const track of stream.getAudioTracks()) {
          stream.removeTrack(track);
          track.stop();
        }
        for (const track of output.stream.getAudioTracks())
          stream.addTrack(track);
        return stream;
      };
      setInterval(() => {
        const shown = document
          .querySelector('[role="timer"]')
          ?.getAttribute('aria-label');
        for (const { key, shows } of given)
          if (shown?.startsWith(`${shows} `)) void speak(key);
        for (const button of document.querySelectorAll('button'))
          if (button.textContent?.trim() === 'Unmute microphone')
            button.click();
      }, 20);
    },
    { given: lines, reaction: reactionMs },
  );

const firstWordOf = (text: string) =>
  text
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}]/gu, '')
    .toLowerCase() ?? '';

for (const [index, { name, reactionMs, prep }] of CASES.entries())
  test(`round ${index + 1}, ${name}: the first word at each floor change`, async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    // Before the Round exists, so the seats arrive early in its countdown.
    const wavs = Object.fromEntries(
      await Promise.all(
        oneOnOneChoice.definition.segments.map(
          async (segment) =>
            [segment.key, await spoken(OPENING_WORDS[segment.key]!)] as const,
        ),
      ),
    );
    const accounts = await createRoomLaunchAccounts(browser, 2);
    try {
      const { round } = await grantedDebaters(
        accounts.members,
        oneOnOneChoice,
        oneOnOneSettings.speechTiming.countdownMs,
      );
      const { segments } = oneOnOneChoice.definition;
      const seats = await Promise.all(
        (['affirmative', 'negative'] as const).map(async (role, seatIndex) => {
          const member = accounts.members[seatIndex]!;
          const own = round.participants.find(
            (entry) => entry.role === role && 'id' in entry,
          );
          if (!own || !('id' in own)) throw new Error('Seat missing');
          const page = await openPage(member.context, `${role} first word`);
          await installSpeaker(
            page,
            await Promise.all(
              segments
                .filter((segment) => segment.side === role)
                .map(async (segment) => ({
                  key: segment.key,
                  shows: clockLabel(segment),
                  wav: wavs[segment.key]!,
                })),
            ),
            reactionMs,
          );
          await page.goto(`/rounds/${round.id}/room`);
          await expectConnected(page);
          return { role, member, id: own.id, page };
        }),
      );
      const deadline =
        nowMs() + PLAY_OUT_LIMIT_MS + (prep === 'ran-out' ? 240_000 : 0);
      const prepared = new Map<string, number>();
      const request = accounts.members[0]!.context.request;
      while (nowMs() < deadline) {
        const view = await readBallotRound(request, round.id);
        if (view.status === 'completed') break;
        const open = view.segments.find(
          (segment) => segment.type === 'speech' && segment.endedAt === null,
        );
        const next = segments[view.segments.length];
        const nextSeat = seats.find((entry) => entry.role === next?.side);
        if (
          prep &&
          next &&
          nextSeat &&
          view.status === 'active' &&
          !view.segments.some((segment) => segment.endedAt === null)
        ) {
          const command = { participantId: nextSeat.id };
          const running = view.checkpoint?.active_prep != null;
          if (!running && !prepared.has(next.key)) {
            if (PREPARED[prep].includes(next.key)) {
              await ballotRoundCommand(nextSeat.member.context.request, view, {
                ...command,
                type: 'start_prep',
              });
              prepared.set(next.key, nowMs());
            }
          } else if (
            running &&
            prep === 'button' &&
            nowMs() - prepared.get(next.key)! >= PREP_BEFORE_BUTTON_MS
          )
            await ballotRoundCommand(nextSeat.member.context.request, view, {
              ...command,
              type: 'start_speech',
            }).catch(() => undefined);
        }
        if (
          open?.startedAt &&
          nowMs() - Date.parse(open.startedAt) >= HOLD_SPEECH_MS
        ) {
          const side = segments.find(
            (segment) => segment.key === open.rulesSegmentKey,
          )?.side;
          const seat = seats.find((entry) => entry.role === side)!;
          await ballotRoundCommand(
            seat.member.context.request,
            await readBallotRound(seat.member.context.request, round.id),
            { type: 'yield', participantId: seat.id },
          ).catch(() => undefined);
        }
        await pause(1000);
      }
      await expect
        .poll(async () => (await readBallotRound(request, round.id)).status, {
          timeout: 60_000,
        })
        .toBe('completed');
      const onsets = Object.fromEntries(
        (
          await Promise.all(
            seats.map(({ page }) =>
              page.evaluate(
                () =>
                  (window as unknown as { firstWordOnsets: object })
                    .firstWordOnsets,
              ),
            ),
          )
        ).flatMap((entries) => Object.entries(entries)),
      ) as Record<string, number>;
      let read = roundTranscriptReadSchema.parse(
        await (await request.get(`/api/rounds/${round.id}/transcript`)).json(),
      );
      for (let wait = 0; wait < 60 && read.freeze === null; wait += 1) {
        await pause(3000);
        read = roundTranscriptReadSchema.parse(
          await (
            await request.get(`/api/rounds/${round.id}/transcript`)
          ).json(),
        );
      }
      const evidence = await drillEvidence(round.id);
      const view = await readBallotRound(request, round.id);
      const results = view.segments.flatMap((segment) => {
        const rule = segments.find(
          (entry) => entry.key === segment.rulesSegmentKey,
        );
        const seat = seats.find((entry) => entry.role === rule?.side);
        if (!rule || !seat) return [];
        const lines = read.utterances
          .filter(
            (line) =>
              line.segmentId === segment.id &&
              line.roundParticipantId === seat.id,
          )
          .sort((a, b) => a.sequence - b.sequence);
        const heardFrom = evidence.observations
          .filter(
            (row) =>
              row.segmentId === segment.id && row.participantId === seat.id,
          )
          .map((row) => Date.parse(row.from));
        const onset = onsets[rule.key] ?? null;
        const clockAt = segment.startedAt
          ? Date.parse(segment.startedAt)
          : null;
        const firstHeard = heardFrom.length ? Math.min(...heardFrom) : null;
        return [
          {
            key: rule.key,
            expected: OPENING_WORDS[rule.key]!.toLowerCase(),
            afterPrep: prepared.has(rule.key),
            first: firstWordOf(lines[0]?.text ?? ''),
            /** The sentence's own later words open the line: the first word is gone. */
            wordLost: /^(is|the|first|word|of|this|speech|and)\b/i.test(
              (lines[0]?.text ?? '').replace(/^\W+/, ''),
            ),
            text: lines[0]?.text.slice(0, 80) ?? null,
            /** The speaker's own clock showed, after the clock started. */
            onsetAfterClockMs:
              onset === null || clockAt === null ? null : onset - clockAt,
            /** Capture's first frame, against the onset: positive would cut the word. */
            captureAfterOnsetMs:
              onset === null || firstHeard === null ? null : firstHeard - onset,
            gapMs: read.streams
              .filter(
                (stream) =>
                  stream.segmentId === segment.id &&
                  stream.roundParticipantId === seat.id,
              )
              .flatMap((stream) => stream.gaps)
              .map((gap) => gap.untilOffsetMs - gap.fromOffsetMs),
          },
        ];
      });
      await mkdir(RESULTS, { recursive: true });
      await writeFile(
        join(RESULTS, `round-${index}.json`),
        JSON.stringify(
          { roundId: round.id, name, reactionMs, results },
          null,
          2,
        ),
      );
      // A record, read across the cases; the bar is judged from all of them together.
    } finally {
      await closeSettledLaunchContexts(accounts).catch(() => undefined);
    }
  });
