import { instantMs } from '@daisy/clock';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  affirmativeSide,
  negativeSide,
  sameSeat,
  sideSeat,
  type SeatRef,
} from '@daisy/protocol/seats';
import { OPENROUTER_E2E_PLACEHOLDER } from '@daisy/ai-voice/testing';
import type { Page } from '@playwright/test';
import { aiCast } from './support/ai-cast';
import { botSpeechEvidence } from './support/bot-speech-evidence';
import { expect, openPage, test } from './support/fixtures';
import { origin } from './support/accounts';
import {
  assignSeat,
  ballotRoundCommand,
  claimSeat,
  createFoundationRoom,
  readBallotRound,
  readyOwnSeat,
  startAdmittedRound,
} from './support/human-ballot-round';
import { checkIn } from './support/human-judged-journey';
import {
  humanRoundSelection,
  type ProofChoice,
} from './support/human-round-selection';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { expectConnected } from './support/round-media';
import { spokenWav } from './support/spoken-wav';
import { leadSideOf } from './support/segment-lead';
import { nowMs } from './support/node-kill-drill-nodes';
import { launchWorkerEnv } from './support/room-launch-worker-policy';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';

/**
 * A full Freestyle-schedule bot Round on real providers (PYL-18, ISSUE-1460):
 * one human Affirmative, whose browser plays espeak-ng speech, against a
 * stored bot Negative, at the format's own default lengths, cross-examination
 * included. It proves the configured bot model speaks every speech and both
 * cross-examinations, and records what the Round bought. It needs a real
 * E2E_OPENROUTER_API_KEY and espeak-ng: bun drill:bot-freestyle, nightly when
 * the repository secret of that name is set.
 */
const LINES: Readonly<Record<string, string>> = {
  AC: 'I affirm that cities should make public transit free at the point of use. First, access: fares fall hardest on low-wage workers, students and older residents, who skip trips to clinics and jobs. Second, efficiency: fare collection costs money and slows boarding. Third, the climate: every rider who leaves a car frees road space and cuts emissions.',
  CX1: 'My question is this. If fares disappear, which service would you cut first when the city budget is tight?',
  CX2: 'Fares are a small share of most transit budgets, so the city covers them from general revenue, the same way it funds roads and libraries.',
  '1AR':
    'The negative says free fares crowd out service, but fares already cover only a small share of costs, and collecting them is expensive. Extend access: a fare is a barrier for exactly the riders who need transit most. Extend efficiency: all-door boarding means more trips with the same buses.',
  '2AR':
    'Three voting issues. Access, because the riders who need transit most are priced out today. Efficiency, because collection costs and slow boarding waste the money the negative wants to protect. And the climate, because the clearest signal to leave the car is a price of zero. Please affirm.',
};
/** How long the human holds each own speech before yielding the floor. */
const HOLD_SPEECH_MS = 25_000;
const PLAY_OUT_LIMIT_MS = 1_800_000;
const RESULTS = resolve(import.meta.dirname, '../test-results/bot-freestyle');

/** Freestyle's one-on-one schedule at its own default lengths, unjudged. */
const freestyleChoice: ProofChoice = {
  definition: oneOnOneDefinition,
  preset: { config: oneOnOneSettings },
};

const pause = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });
/** Every line voiced by espeak-ng. */
const spokenLines = async (lines: Readonly<Record<string, string>>) => {
  const wavs: Record<string, string> = {};
  for (const [key, text] of Object.entries(lines))
    wavs[key] = await spokenWav(text);
  return wavs;
};

/** The human's own clock label for a segment it leads or answers in. */
const shows = (segment: (typeof oneOnOneDefinition.segments)[number]) =>
  segment.type !== 'cross_ex'
    ? `${segment.key} · ${segment.label}`
    : `Cross-examination · ${leadSideOf(segment.speak) === affirmativeSide ? 'You ask' : 'You answer'}`;

/** The seat's microphone plays each line once its own clock shows that label. */
const installSpeaker = (
  page: Page,
  lines: readonly { key: string; shows: string; wav: string }[],
) =>
  page.addInitScript((given: typeof lines) => {
    const native = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const audio = new AudioContext();
    const output = audio.createMediaStreamDestination();
    const buffers = new Map(
      given.map(({ key, wav }) => [
        key,
        audio.decodeAudioData(
          Uint8Array.from(atob(wav), (c) => c.charCodeAt(0)).buffer,
        ),
      ]),
    );
    const played = new Set<string>();
    const speak = async (key: string) => {
      if (played.has(key)) return;
      played.add(key);
      const source = audio.createBufferSource();
      source.buffer = (await buffers.get(key)) ?? null;
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
      const label = document
        .querySelector('[role="timer"]')
        ?.getAttribute('aria-label');
      for (const line of given)
        if (label?.startsWith(`${line.shows} `)) void speak(line.key);
      for (const button of document.querySelectorAll('button'))
        if (button.textContent?.trim() === 'Unmute microphone') button.click();
    }, 20);
  }, lines);

test('a full Freestyle bot Round speaks every bot turn on the configured model', async ({
  browser,
}) => {
  // A stubbed provider would pass every check below: refuse to run without a real key.
  const key = process.env.E2E_OPENROUTER_API_KEY;
  if (!key || key === OPENROUTER_E2E_PLACEHOLDER)
    throw new Error(
      'bun drill:bot-freestyle needs a real E2E_OPENROUTER_API_KEY',
    );
  test.setTimeout(PLAY_OUT_LIMIT_MS + 300_000);
  const { segments } = freestyleChoice.definition;
  const wavs = await spokenLines(LINES);
  const accounts = await createRoomLaunchAccounts(browser, 1, {
    botDebates: true,
  });
  try {
    const host = accounts.members[0]!;
    const catalog = await host.context.request.get('/api/rooms/catalog');
    expect(catalog.status()).toBe(200);
    const { debater } = aiCast(await catalog.json());
    let room = await createFoundationRoom(
      host,
      (choice) => humanRoundSelection(choice, 0),
      freestyleChoice,
    );
    room = await claimSeat(host, room, sideSeat(affirmativeSide));
    room = await assignSeat(host, room, {
      actorId: debater.actorId,
      seat: sideSeat(negativeSide),
    });
    room = await readyOwnSeat(host, room, sideSeat(affirmativeSide));
    const started = await startAdmittedRound(host, room);
    await host.context.grantPermissions(['camera', 'microphone'], { origin });
    const stage = await openPage(host.context, 'human in the bot Freestyle');
    await installSpeaker(
      stage,
      segments
        .filter((segment) => LINES[segment.key])
        .map((segment) => ({
          key: segment.key,
          shows: shows(segment),
          wav: wavs[segment.key]!,
        })),
    );
    await stage.goto(`/rounds/${started.id}/room`);
    await expectConnected(stage);
    const request = host.context.request;
    const checkedIn = new Set<string>();
    const deadline = nowMs() + PLAY_OUT_LIMIT_MS;
    for (;;) {
      const view = await readBallotRound(request, started.id);
      if (view.status === 'completed' || nowMs() > deadline) break;
      const open = view.segments.find((segment) => segment.endedAt === null);
      const rule = segments.find((s) => s.key === open?.rulesSegmentKey);
      const human = view.participants.find(
        (p) => 'id' in p && sameSeat(p.seat, sideSeat(affirmativeSide)),
      ) as { id: string } | undefined;
      if (open && rule && !checkedIn.has(open.id)) {
        checkedIn.add(open.id);
        await checkIn(host, view, open.id).catch(() => undefined);
      }
      // The human yields its own speeches; cross-examination runs its clock.
      if (
        open?.startedAt &&
        rule?.type === 'speech' &&
        leadSideOf(rule.speak) === affirmativeSide &&
        human &&
        nowMs() - instantMs(open.startedAt) >= HOLD_SPEECH_MS
      )
        await ballotRoundCommand(request, view, {
          type: 'yield',
          participantId: human.id,
          sequence: open.sequence,
        }).catch(() => undefined);
      await pause(1000);
    }
    const view = await readBallotRound(request, started.id);
    const { runs, lines } = await botSpeechEvidence(started.id);
    const bot: SeatRef = sideSeat(negativeSide);
    const own = runs.filter((run) => sameSeat(run.seat, bot));
    const received = (kind: string, segment?: string) =>
      own.filter(
        (run) =>
          run.kind === kind &&
          run.outcome === 'received' &&
          run.requests > 0 &&
          (segment === undefined || run.segment === segment),
      );
    const total = (kind: string) =>
      own
        .filter((run) => run.kind === kind)
        .reduce(
          (sum, run) => ({
            calls: sum.calls + run.requests,
            received: sum.received + (run.outcome === 'received' ? 1 : 0),
            inputTokens: sum.inputTokens + run.inputTokens,
            outputTokens: sum.outputTokens + run.outputTokens,
            characters: sum.characters + run.characters,
          }),
          {
            calls: 0,
            received: 0,
            inputTokens: 0,
            outputTokens: 0,
            characters: 0,
          },
        );
    await mkdir(RESULTS, { recursive: true });
    await writeFile(
      join(RESULTS, `${started.id}.json`),
      JSON.stringify(
        {
          roundId: started.id,
          status: view.status,
          segments: view.segments.map((s) => ({
            key: s.rulesSegmentKey,
            durationMs: s.durationMs,
            ranMs:
              s.startedAt && s.endedAt
                ? instantMs(s.endedAt) - instantMs(s.startedAt)
                : null,
          })),
          models: [...new Set(own.map((run) => `${run.kind}:${run.model}`))],
          usage: Object.fromEntries(
            ['speech', 'cross_ex', 'tts'].map((kind) => [kind, total(kind)]),
          ),
          failed: own
            .filter((run) => run.requests > 0 && run.outcome !== 'received')
            .map((run) => ({
              kind: run.kind,
              segment: run.segment,
              outcome: run.outcome,
            })),
          spokenLines: lines.filter((line) => sameSeat(line.seat, bot)).length,
        },
        null,
        2,
      ),
    );
    expect(view.status).toBe('completed');
    // Every language answer came from the policy's own models (ISSUE-1460).
    const { models } = JSON.parse(launchWorkerEnv.ROUND_BOT_WORKER_POLICY) as {
      models: Record<'speech' | 'cross_ex', string>;
    };
    for (const kind of ['speech', 'cross_ex'] as const)
      expect(
        [...new Set(received(kind).map((run) => run.model))],
        `${kind} model`,
      ).toEqual([models[kind]]);
    for (const key of ['NC', 'NR'])
      expect(
        received('speech', key).filter((run) => run.outputTokens > 0),
        `${key} answered`,
      ).not.toHaveLength(0);
    for (const key of ['CX1', 'CX2'])
      expect(
        received('cross_ex', key).filter((run) => run.outputTokens > 0),
        `${key} answered`,
      ).not.toHaveLength(0);
    expect(received('tts').length).toBeGreaterThan(0);
    expect(
      lines.filter((line) => sameSeat(line.seat, bot)).length,
    ).toBeGreaterThan(0);
  } finally {
    await closeSettledLaunchContexts(accounts).catch(() => undefined);
  }
});
