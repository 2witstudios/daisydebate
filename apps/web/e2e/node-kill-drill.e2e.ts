import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { systemClock } from '@daisy/clock';
import { roundTranscriptReadSchema } from '@daisy/protocol';
import {
  captureBackAfter,
  captureCoverage,
  isDirectUdp,
  nodeCarrying,
  owedBy,
  seatIsHealthy,
  seatRecovery,
  type IceTransport,
  type SeatRead,
} from '../scripts/node-kill-drill/measure';
import {
  buildDrillReport,
  drillReportTable,
  drillSampleSchema,
  type DrillSample,
} from '../scripts/node-kill-drill/report';
import {
  drillKillPlan,
  readDrillTarget,
  type DrillMoment,
} from '../scripts/node-kill-drill/target';
import { actualSpeech } from './support/attendance-browser';
import {
  ballotRoundCommand,
  readBallotRound,
} from './support/human-ballot-round';
import { expect, openPage, test } from './support/fixtures';
import {
  drillEvidence,
  type DrillEvidence,
} from './support/node-kill-drill-evidence';
import {
  ensureNodesServing,
  killNode,
  nowMs,
  watchNodeReturn,
} from './support/node-kill-drill-nodes';
import {
  probeSeat,
  watchPeerConnections,
  type SeatProbe,
} from './support/node-kill-drill-probe';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  expectConnected,
  grantedDebaters,
  installMediaCapture,
  readMediaState,
} from './support/round-media';

/**
 * Spike step 3, on demand and never in CI: kill the node holding a live Round,
 * through a real browser per seat, and measure from the kill. Each kill is its
 * own Round. A sample records what happened and passes; the last test writes
 * the report and fails if a bar did. See node-kill-drill-runner.ts.
 */
const target = readDrillTarget(process.env);
const plan = drillKillPlan(process.env.DRILL_KILLS);
const runDir = process.env.DRILL_RUN_DIR;
if (!runDir) throw new Error('Node kill drill needs its runner');

const SPEECH_BEFORE_KILL_MS = 20_000;
const READ_EVERY_MS = 500;
const READ_LIMIT_MS = 3000;
/** Long enough to see any bar missed, and to see speech captured after recovery. */
const WATCH_MIN_MS = 45_000;
const WATCH_MAX_MS = 75_000;
/** One node has no survivor: give the platform this long to restart it first. */
const PLATFORM_RESTART_MS = 120_000;
const UNSAFE_BAR_MS = 60_000;
const NEXT_SPEECH_MS = 15_000;
const SEAL_LIMIT_MS = 180_000;

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const ms = (value: string) => Date.parse(value);

type Member = Awaited<
  ReturnType<typeof createRoomLaunchAccounts>
>['members'][number];
type Seat = {
  readonly name: DrillSample['seats'][number]['seat'];
  readonly member: Member;
  readonly participantId: string;
  readonly page: Page;
};

const bounded = <T>(read: Promise<T>) =>
  Promise.race([
    read,
    pause(READ_LIMIT_MS).then(() => {
      throw new Error('read limit');
    }),
  ]);

const stillOwedAudio = async (seat: Seat, roundId: string) => {
  const state = await readMediaState(seat.member, roundId);
  return state.peers.some(
    (peer) => peer.microphone && peer.participantId !== seat.participantId,
  );
};

/** Reads a seat twice a second until told to stop, keeping its health over time. */
function watchSeat(seat: Seat, roundId: string) {
  const reads: { atMs: number; ready: boolean }[] = [];
  let stopped = false;
  let owed = false;
  let previous: SeatRead | null = null;
  let latest: SeatProbe | null = null;
  const owedReader = (async () => {
    while (!stopped) {
      try {
        owed = await bounded(stillOwedAudio(seat, roundId));
      } catch {
        // An outage may refuse this read; the last answer stands.
      }
      await pause(2000);
    }
  })();
  const reader = (async () => {
    while (!stopped) {
      const atMs = nowMs();
      try {
        const read: SeatProbe = await bounded(probeSeat(seat.page));
        reads.push({ atMs, ready: seatIsHealthy(previous, read, owed) });
        previous = read;
        latest = read;
      } catch {
        reads.push({ atMs, ready: false });
      }
      await pause(READ_EVERY_MS);
    }
  })();
  return {
    reads,
    latest: () => latest,
    finish: async () => {
      stopped = true;
      await Promise.all([owedReader, reader]);
    },
  };
}

/** Waits for healthy media through this seat before anything is killed. */
async function untilHealthy(seat: Seat, roundId: string) {
  const watch = watchSeat(seat, roundId);
  try {
    const deadline = nowMs() + 60_000;
    while (
      watch.reads.length < 2 ||
      !watch.reads.slice(-2).every((read) => read.ready)
    ) {
      if (nowMs() > deadline)
        throw new Error(
          `${seat.name} never healthy before the kill: ${JSON.stringify(watch.latest())}`,
        );
      await pause(READ_EVERY_MS);
    }
    return watch.latest()?.transports ?? [];
  } finally {
    await watch.finish();
  }
}

/** The seat's admissions from now on, and how each was answered. */
const countAdmissions = (page: Page) => {
  const isSession = (url: string) =>
    new URL(url).pathname.endsWith('/media/session');
  let admissionsAfterKill = 0;
  const admissionStatuses: number[] = [];
  page.on('request', (request) => {
    if (isSession(request.url())) admissionsAfterKill++;
  });
  page.on('response', (response) => {
    if (isSession(response.url())) admissionStatuses.push(response.status());
  });
  return () => ({ admissionsAfterKill, admissionStatuses });
};

/** A seat's sound is enabled once, by a person's press, as in the Round. */
const enableSound = async (page: Page) => {
  const button = page.getByRole('button', {
    name: 'Enable sound',
    exact: true,
  });
  if (await button.isVisible()) await button.click();
};

/** Ends whichever speech is open, as its speaker, until none is left or time runs out. */
async function endOpenSpeech(members: readonly Member[], roundId: string) {
  const request = members[0]!.context.request;
  const view = await readBallotRound(request, roundId);
  const open = view.segments.find(
    (segment) => segment.type === 'speech' && segment.endedAt === null,
  );
  if (!open) return false;
  // The proof format's two speeches: AC is the affirmative's, NC the negative's.
  const role = open.rulesSegmentKey === 'AC' ? 'affirmative' : 'negative';
  const speaker = view.participants.find(
    (seat) => seat.role === role && 'id' in seat,
  );
  if (!speaker || !('id' in speaker)) throw new Error('Speaker seat missing');
  const member = members[role === 'affirmative' ? 0 : 1]!;
  await ballotRoundCommand(
    member.context.request,
    await readBallotRound(member.context.request, roundId),
    { type: 'yield', participantId: speaker.id },
  );
  return true;
}

const retrying = async <T>(limitMs: number, act: () => Promise<T>) => {
  const deadline = nowMs() + limitMs;
  for (;;) {
    try {
      return await act();
    } catch (error) {
      if (nowMs() > deadline) throw error;
      await pause(2000);
    }
  }
};

const observedIn = (evidence: DrillEvidence) =>
  evidence.observations.map((row) => ({
    start: ms(row.from),
    end: ms(row.until),
  }));

/** Coverage and hole size per stream, from the server's own observations. */
function streamCoverage(evidence: DrillEvidence, killMs: number) {
  const nowMs = ms(evidence.observedAt);
  const captureBack = captureBackAfter(observedIn(evidence), killMs);
  const outage = {
    start: killMs,
    end: captureBack === null ? nowMs : killMs + captureBack,
  };
  const keyOf = (row: { segmentId: string; participantId: string }) =>
    `${row.segmentId} ${row.participantId}`;
  const owedByStream = new Map<string, { start: number; end: number }[]>();
  for (const grant of evidence.grants) {
    const segment = evidence.segments.find(
      (entry) => entry.id === grant.segmentId,
    );
    if (!segment) continue;
    const owed = owedBy(
      [
        {
          start: ms(grant.startedAt),
          end: grant.endedAt ? ms(grant.endedAt) : null,
        },
      ],
      {
        startMs: ms(segment.startedAt),
        endMs: segment.endedAt ? ms(segment.endedAt) : null,
        durationMs: segment.durationMs,
      },
      nowMs,
    );
    owedByStream.set(keyOf(grant), [
      ...(owedByStream.get(keyOf(grant)) ?? []),
      ...owed,
    ]);
  }
  const observedOf = (key: string) =>
    evidence.observations
      .filter((row) => keyOf(row) === key)
      .map((row) => ({ start: ms(row.from), end: ms(row.until) }));
  const perStream = new Map(
    [...owedByStream].map(([key, owed]) => [
      key,
      captureCoverage(owed, observedOf(key), outage),
    ]),
  );
  const whole = captureCoverage(
    [...owedByStream.values()].flat(),
    [...owedByStream.keys()].flatMap(observedOf),
    outage,
  );
  return { whole, perStream };
}

const emptySample = (index: number, moment: DrillMoment): DrillSample => ({
  index,
  moment,
  killed: false,
  node: null,
  roundId: null,
  killCommandMs: null,
  seats: [],
  captureBackMs: null,
  coverage: null,
  streams: [],
  penalties: null,
  roundStatus: null,
  roundMs: 0,
  incidents: null,
  returnedMs: null,
  airtimeLostMs: null,
  killSentAt: null,
  unsafeSeen: null,
  unsafeAfter60s: null,
  nodeBackMs: null,
  nodeStartedBy: null,
  errors: [],
});
const messageOf = (error: unknown) =>
  // A bounded first line: never a page dump, a token or a URL with a query.
  (error instanceof Error ? error.message : 'unknown failure')
    .replaceAll(new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'g'), '')
    .split('\n')[0]!
    .replace(/\?\S*/g, '')
    .slice(0, 400);

const samplePath = (index: number) =>
  resolve(runDir, `sample-${String(index).padStart(2, '0')}.json`);

async function drillOneKill(
  browser: Parameters<typeof createRoomLaunchAccounts>[0],
  sample: DrillSample,
) {
  await ensureNodesServing(target);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  const single = target.nodes.length === 1;
  let draft = sample;
  let node: (typeof target.nodes)[number] | null = null;
  let nodeWatch: ReturnType<typeof watchNodeReturn> | null = null;
  try {
    const { round, speaker, listener } = await grantedDebaters(
      accounts.members,
    );
    draft = { ...draft, roundId: round.id };
    const seats: readonly Seat[] = await Promise.all(
      (
        [
          ['first-speaker', speaker, 'affirmative'],
          ['second-speaker', listener, 'negative'],
        ] as const
      ).map(async ([name, member, role]) => {
        const own = round.participants.find(
          (entry) => entry.role === role && 'id' in entry,
        );
        if (!own || !('id' in own)) throw new Error('Seat missing');
        const page = await openPage(member.context, `${name} in the drill`);
        await watchPeerConnections(page);
        await installMediaCapture(page, 'alternating');
        await page.goto(`/rounds/${round.id}/room`);
        await expectConnected(page);
        await enableSound(page);
        return { name, member, participantId: own.id, page };
      }),
    );
    const speech = await actualSpeech(speaker.context.request, round.id);
    const before = await Promise.all(
      seats.map((seat) => untilHealthy(seat, round.id)),
    );
    // Capture was running before the kill, or its return would prove nothing.
    await expect
      .poll(async () => (await drillEvidence(round.id)).observations.length, {
        timeout: 60_000,
        intervals: [2000],
      })
      .toBeGreaterThan(0);
    const into = nowMs() - Date.parse(speech.startedAt!);
    if (into < SPEECH_BEFORE_KILL_MS) await pause(SPEECH_BEFORE_KILL_MS - into);
    const transports: readonly IceTransport[] = before.flat();
    node = nodeCarrying(target.nodes, transports);
    if (!node)
      throw new Error('The seats reach no one configured node: nothing killed');

    const watches = seats.map((seat) => watchSeat(seat, round.id));
    // A first read has nothing to compare, so each seat reads before the kill.
    while (watches.some((watch) => watch.reads.length < 2))
      await pause(READ_EVERY_MS);
    const killSentAt = systemClock.now();
    const killMs = Date.parse(killSentAt);
    const admissions = seats.map((seat) => countAdmissions(seat.page));
    await killNode(target, node);
    const killCommandMs = nowMs() - killMs;
    nodeWatch = watchNodeReturn(target, node, killMs);
    draft = {
      ...draft,
      killed: true,
      node: node.app,
      killCommandMs,
      killSentAt,
    };
    const floorMoved =
      sample.moment === 'floor-change'
        ? retrying(10_000, () => endOpenSpeech(accounts.members, round.id))
        : null;

    let unsafeSeen = false;
    let unsafeNow = false;
    const elapsed = () => nowMs() - killMs;
    const allBack = () =>
      watches.every(
        (watch) => seatRecovery(watch.reads, killMs).backMs !== null,
      );
    let captureSeen = false;
    if (single) {
      while (nodeWatch.backMs() === null && elapsed() < PLATFORM_RESTART_MS)
        await pause(1000);
      await nodeWatch.startIfDown();
    }
    const watchFrom = nowMs();
    while (
      nowMs() - watchFrom < WATCH_MIN_MS ||
      (unsafeNow && elapsed() < UNSAFE_BAR_MS + 5000) ||
      (nowMs() - watchFrom < WATCH_MAX_MS && !(allBack() && captureSeen))
    ) {
      try {
        const evidence = await drillEvidence(round.id);
        unsafeNow = evidence.sessions.some(
          (session) => session.unsafeAt !== null,
        );
        if (unsafeNow) unsafeSeen = true;
        captureSeen = captureBackAfter(observedIn(evidence), killMs) !== null;
      } catch {
        // The read is only a progress check; the final read is the record.
      }
      await pause(3000);
    }
    const seatsAfter = watches.map((watch) => watch.latest()?.transports ?? []);
    await Promise.all(watches.map((watch) => watch.finish()));
    await floorMoved?.catch((error) => {
      draft = {
        ...draft,
        errors: [...draft.errors, `floor change: ${messageOf(error)}`],
      };
    });
    const seatResults = seats.map((seat, index) => {
      const recovery = seatRecovery(watches[index]!.reads, killMs);
      return {
        seat: seat.name,
        ...recovery,
        ...admissions[index]!(),
        lastStatuses: [...(watches[index]!.latest()?.statuses ?? [])],
        udpBefore: isDirectUdp(before[index]!),
        udpAfter:
          recovery.backMs === null ? null : isDirectUdp(seatsAfter[index]!),
      };
    });

    // The Round goes on: the rest of this speech is given up, the next is held
    // briefly so capture is owed after recovery, and then it ends.
    if (sample.moment === 'mid-speech')
      await retrying(120_000, () => endOpenSpeech(accounts.members, round.id));
    await pause(NEXT_SPEECH_MS);
    await retrying(120_000, () => endOpenSpeech(accounts.members, round.id));

    await expect
      .poll(
        async () =>
          (await readBallotRound(speaker.context.request, round.id)).status,
        { timeout: 170_000, intervals: [2000] },
      )
      .toBe('completed')
      .catch((error) => {
        draft = {
          ...draft,
          errors: [...draft.errors, `completion: ${messageOf(error)}`],
        };
      });
    let streams: DrillSample['streams'] = [];
    const sealDeadline = nowMs() + SEAL_LIMIT_MS;
    for (;;) {
      const response = await speaker.context.request.get(
        `/api/rounds/${round.id}/transcript`,
      );
      expect(response.status()).toBe(200);
      const read = roundTranscriptReadSchema.parse(await response.json());
      const evidence = await drillEvidence(round.id);
      const { whole, perStream } = streamCoverage(evidence, killMs);
      streams = read.streams.map((stream) => ({
        state: stream.state,
        partialReasons: [...stream.partialReasons],
        gapCount: stream.gaps.length,
        gapMs: stream.gaps.reduce(
          (total, gap) => total + gap.untilOffsetMs - gap.fromOffsetMs,
          0,
        ),
        missingMs:
          [...perStream].find(([key]) =>
            key.startsWith(`${stream.segmentId} ${stream.roundParticipantId}`),
          )?.[1].missingMs ?? 0,
      }));
      if (
        (read.freeze !== null && streams.every((s) => s.state !== 'open')) ||
        nowMs() > sealDeadline
      ) {
        const first = evidence.segments[0];
        const last = evidence.segments.at(-1);
        return {
          ...draft,
          seats: seatResults,
          captureBackMs: captureBackAfter(observedIn(evidence), killMs),
          coverage: whole && {
            ...whole,
            holes: whole.holes.map(({ start, end }) => ({
              start: start - killMs,
              end: end - killMs,
            })),
          },
          streams,
          penalties: evidence.adjudications.filter((row) =>
            ['forfeit', 'abandoned'].includes(row.decision),
          ).length,
          roundStatus: evidence.status,
          roundMs:
            first && last?.endedAt ? ms(last.endedAt) - ms(first.startedAt) : 0,
          incidents: evidence.incidents,
          returnedMs: evidence.returnedMs,
          // What the speaker said after the node died and did not get back: time from the
          // kill to the point the Round resumed from. Null when no speech was held.
          airtimeLostMs: evidence.resumePoints[0]
            ? Math.max(0, ms(evidence.resumePoints[0]) - killMs)
            : null,
          unsafeSeen:
            unsafeSeen ||
            evidence.sessions.some((session) => session.unsafeAt !== null),
          unsafeAfter60s:
            (unsafeNow && elapsed() >= UNSAFE_BAR_MS) ||
            (nowMs() - killMs >= UNSAFE_BAR_MS &&
              evidence.sessions.some((session) => session.unsafeAt !== null)),
          nodeBackMs: nodeWatch.backMs(),
          nodeStartedBy:
            nodeWatch.backMs() === null
              ? null
              : nodeWatch.startedByDrill()
                ? ('drill' as const)
                : ('platform' as const),
        } satisfies DrillSample;
      }
      await pause(3000);
    }
  } catch (error) {
    return { ...draft, errors: [...draft.errors, messageOf(error)] };
  } finally {
    // The node comes back whatever happened, and only ever through the start command.
    await nodeWatch?.startIfDown().catch(() => undefined);
    await nodeWatch?.finish();
    await closeSettledLaunchContexts(accounts).catch(() => undefined);
  }
}

test('the browser reaches each scratch node', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await openPage(context, 'node reach check');
  try {
    for (const node of target.nodes) {
      const response = await page.goto(
        node.publicUrl.replace(/^wss:/, 'https:'),
      );
      // An edge or node answering at all shows the container's route and trust.
      expect(response?.status(), node.app).toBeLessThan(500);
    }
  } finally {
    await context.close();
  }
});

for (const [index, moment] of plan.entries())
  test(`kill ${index + 1} of ${plan.length}: ${moment}`, async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    await mkdir(runDir, { recursive: true });
    let sample = emptySample(index, moment);
    try {
      sample = await drillOneKill(browser, sample);
    } catch (error) {
      sample = { ...sample, errors: [...sample.errors, messageOf(error)] };
    }
    await writeFile(samplePath(index), JSON.stringify(sample, null, 2));
  });

test('the report, and every bar held', async () => {
  await mkdir(runDir, { recursive: true });
  const files = (await readdir(runDir)).filter((name) =>
    name.startsWith('sample-'),
  );
  const samples = await Promise.all(
    files
      .sort()
      .map(async (name) =>
        drillSampleSchema.parse(
          JSON.parse(await readFile(resolve(runDir, name), 'utf8')),
        ),
      ),
  );
  const report = buildDrillReport({
    label: target.label,
    commit: process.env.DRILL_COMMIT ?? 'unknown',
    nodes: target.nodes.map((node) => node.app),
    planned: plan.length,
    samples,
  });
  const table = drillReportTable(report);
  await writeFile(
    resolve(runDir, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  await writeFile(resolve(runDir, 'report.md'), `${table}\n`);
  process.stdout.write(`${table}\n`);
  expect(Object.values(report.bars)).toEqual(
    Array(Object.keys(report.bars).length).fill('pass'),
  );
});
