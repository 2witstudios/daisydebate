import type { Browser } from '@playwright/test';
import {
  deriveOutageIntervals,
  effectiveAttendanceDeadline,
} from '@daisy/debate-engine';
import { attendanceTimingPolicy } from '@daisy/protocol';
import {
  attendanceReceiptTime,
  attendanceTimestamp,
} from '../../src/features/attendance/receipt-time';
import { expect } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { createHumanBallotRound } from './human-ballot-round';
import {
  actualSpeech,
  enterSpeech,
  nextReceipt,
  healthyAttendance,
  attendedResolution,
  closeAttendedFixture,
} from './attendance-browser';
import { attendanceEvidence } from './attendance-evidence';
import { elapsedAttendanceObservationUs } from './attendance-evidence-decoder';
import {
  controlLaunch,
  closeSettledLaunchContexts,
} from './room-launch-settled';

const latestSample = async (roundId: string) =>
  (await attendanceEvidence(roundId)).samples.at(-1)!.at;

/**
 * On one shared runner a booting process starves the serving one's 900 ms
 * public probe; in production the peer boots on its own machine. So after
 * each process start the measured window resumes only once three
 * consecutive samples taken after the start are healthy (the started
 * process is ready); both ingress switches stay inside the window.
 * An outage outside the windows (a boot, an opening check-in still in
 * flight) still postpones the deadline, so the deadline equals the engine's
 * over the samples (the wiring) and is bounded engine-free: nothing after
 * `since` postponed it, and the grace ended inside measured window 1.
 */
async function settledAfter(roundId: string, after: string) {
  let resumed = after;
  await expect
    .poll(
      async () => {
        const recent = (await attendanceEvidence(roundId)).samples
          .filter((row) => row.at > after)
          .slice(-3);
        resumed = recent.at(-1)?.at ?? after;
        // A gap over 2 s inside the trio would reopen the engine's outage.
        return (
          recent.length === 3 &&
          recent.every((row) => row.healthy) &&
          recent
            .slice(1)
            .every(
              (row, index) =>
                elapsedAttendanceObservationUs(row.at, recent[index]!.at) <=
                2_000_000n,
            )
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return resumed;
}

export async function rollingAttendancePeer({
  browser,
}: {
  readonly browser: Browser;
}) {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  const host = accounts.members[0]!.context;
  let primaryStopped = false,
    peerStarted = false;
  try {
    const round = await createHumanBallotRound(accounts.members);
    const speech = await actualSpeech(host.request, round.id);
    const present = await Promise.all(
      accounts.members
        .slice(0, 2)
        .map((member) => enterSpeech(member.context, round.id, 'rolling peer')),
    );
    await healthyAttendance(round.id);
    const beforePeer = await latestSample(round.id);
    await controlLaunch('start-web-peer');
    peerStarted = true;
    await expect
      .poll(
        async () => {
          const facts = await attendanceEvidence(round.id);
          return facts.instances.filter(
            (row) =>
              row.role === 'web' &&
              Date.parse(facts.observedAt) - Date.parse(row.renewedAt) < 3_000,
          ).length;
        },
        { timeout: 15_000 },
      )
      .toBe(2);
    const since = await settledAfter(round.id, beforePeer);
    await controlLaunch('use-web-peer');
    await controlLaunch('stop-web');
    primaryStopped = true;
    await expect
      .poll(
        async () => {
          const facts = await attendanceEvidence(round.id);
          return facts.instances.some(
            (row) =>
              row.role === 'web' &&
              Date.parse(facts.observedAt) - Date.parse(row.renewedAt) > 3_000,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const replay = await nextReceipt(present[0]!.page, round.id, () =>
      present[0]!.page.reload(),
    );
    expect(replay.receivedAt).toBe(present[0]!.receipt.receivedAt);
    expect(replay.replayed).toBe(true);
    await attendedResolution(round.id, speech.id);
    const paused = await latestSample(round.id);
    await controlLaunch('start-web');
    primaryStopped = false;
    const resumed = await settledAfter(round.id, paused);
    await controlLaunch('use-primary-web');
    const beforePeerStop = await latestSample(round.id);
    await controlLaunch('stop-web-peer');
    peerStarted = false;
    await settledAfter(round.id, beforePeerStop);
    const facts = await attendanceEvidence(round.id);
    const windows = [
      facts.samples.filter((row) => row.at >= since && row.at <= paused),
      facts.samples.filter((row) => row.at >= resumed),
    ];
    for (const samples of windows) {
      expect(samples.length).toBeGreaterThan(3);
      // Name each unhealthy sample's cause, so a CI failure says which signal broke.
      expect(samples.filter((row) => !row.healthy)).toEqual([]);
      expect(
        samples
          .slice(1)
          .every(
            (row, index) =>
              elapsedAttendanceObservationUs(row.at, samples[index]!.at) <=
              2_000_000n,
          ),
      ).toBe(true);
    }
    expect(facts.status).toBe('active');
    const decision = facts.adjudications.find(
      (row) => row.segmentId === speech.id,
    )!;
    const settled = facts.samples.filter(
      (row) => row.at <= decision.settledHorizon,
    );
    expect(settled[0]!.at <= speech.startedAt).toBe(true);
    expect(decision.effectiveDeadline).toBe(
      attendanceTimestamp(
        effectiveAttendanceDeadline({
          openedAtMs: attendanceReceiptTime(speech.startedAt),
          graceMs: attendanceTimingPolicy.graceMs,
          availability: deriveOutageIntervals(
            settled.map((row) => ({
              atMs: attendanceReceiptTime(row.at),
              healthy: row.healthy,
            })),
          ),
        })!,
      ),
    );
    const graceUs = BigInt(attendanceTimingPolicy.graceMs) * 1000n;
    expect(
      elapsedAttendanceObservationUs(
        decision.effectiveDeadline,
        speech.startedAt,
      ),
    ).toBeGreaterThanOrEqual(graceUs);
    expect(
      elapsedAttendanceObservationUs(decision.effectiveDeadline, since),
    ).toBeLessThanOrEqual(graceUs);
    expect(
      elapsedAttendanceObservationUs(paused, decision.effectiveDeadline),
    ).toBeGreaterThanOrEqual(0n);
    await closeAttendedFixture(
      host.request,
      round.id,
      present[0]!.receipt.participantId,
    );
  } finally {
    try {
      if (primaryStopped) await controlLaunch('start-web');
      await controlLaunch('use-primary-web');
      if (peerStarted) await controlLaunch('stop-web-peer');
    } finally {
      await closeSettledLaunchContexts(accounts);
    }
  }
}
