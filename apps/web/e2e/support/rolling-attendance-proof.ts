import type { Browser } from '@playwright/test';
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
    const since = (await attendanceEvidence(round.id)).samples.at(-1)!.at;
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
    await controlLaunch('start-web');
    primaryStopped = false;
    await controlLaunch('use-primary-web');
    await controlLaunch('stop-web-peer');
    peerStarted = false;
    await healthyAttendance(round.id);
    const facts = await attendanceEvidence(round.id);
    const samples = facts.samples.filter((row) => row.at >= since);
    expect(samples.length).toBeGreaterThan(3);
    expect(samples.every((row) => row.healthy)).toBe(true);
    expect(
      samples
        .slice(1)
        .every(
          (row, index) =>
            elapsedAttendanceObservationUs(row.at, samples[index]!.at) <=
            2_000_000n,
        ),
    ).toBe(true);
    expect(facts.status).toBe('active');
    const decision = facts.adjudications.find(
      (row) => row.segmentId === speech.id,
    )!;
    expect(
      elapsedAttendanceObservationUs(
        decision.effectiveDeadline,
        speech.startedAt,
      ),
    ).toBe(40_000_000n);
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
