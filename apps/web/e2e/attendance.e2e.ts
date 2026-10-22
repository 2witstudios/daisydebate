import { test, expect } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { attendanceEvidence } from './support/attendance-evidence';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
} from './support/human-ballot-round';
import {
  receiptResponse,
  receiptFrom,
  actualSpeech,
  enterSpeech,
  nextReceipt,
} from './support/attendance-browser';
import { nativeAttendanceOutage } from './support/native-attendance-proof';
import { serviceAttendanceOutage } from './support/service-attendance-proof';
import { rollingAttendancePeer } from './support/rolling-attendance-proof';

test('actual speech check-in survives refresh and a real browser network disconnect without changing its first stamp', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const round = await createHumanBallotRound(accounts.members);
    await actualSpeech(accounts.members[0]!.context.request, round.id);
    const [speaker, opponent] = await Promise.all(
      accounts.members
        .slice(0, 2)
        .map((member, index) =>
          enterSpeech(member.context, round.id, `attendance debater ${index}`),
        ),
    );
    expect(speaker!.receipt.segmentId).toBe(opponent!.receipt.segmentId);
    expect(speaker!.receipt.participantId).not.toBe(
      opponent!.receipt.participantId,
    );
    const refreshed = await nextReceipt(speaker!.page, round.id, () =>
      speaker!.page.reload(),
    );
    expect(refreshed.receivedAt).toBe(speaker!.receipt.receivedAt);
    expect(refreshed.replayed).toBe(true);
    await accounts.members[0]!.context.setOffline(true);
    const rejoined = await nextReceipt(speaker!.page, round.id, () =>
      accounts.members[0]!.context.setOffline(false),
    );
    expect(rejoined.receivedAt).toBe(speaker!.receipt.receivedAt);
    expect(
      (await readBallotRound(accounts.members[1]!.context.request, round.id))
        .status,
    ).toBe('active');
    const judge = await accounts.members[2]!.context.request.post(
      `/api/rounds/${round.id}/check-in`,
      {
        headers: { origin: new URL(speaker!.page.url()).origin },
        data: {
          version: 1,
          commandId: speaker!.receipt.commandId,
          segmentId: speaker!.receipt.segmentId,
        },
      },
    );
    expect(judge.status()).toBe(403);
    await accounts.members[0]!.context.setOffline(true);
    const current = await readBallotRound(
      accounts.members[1]!.context.request,
      round.id,
    );
    // An independent authenticated HTTP client ends the actual speech while this page is disconnected.
    await ballotRoundCommand(accounts.members[0]!.context.request, current, {
      type: 'yield',
      participantId: speaker!.receipt.participantId,
    });
    let target: string | undefined;
    await expect
      .poll(
        async () => {
          const next = await readBallotRound(
            accounts.members[1]!.context.request,
            round.id,
          );
          const speech = next.segments.find(
            (segment) =>
              segment.type === 'speech' &&
              segment.endedAt === null &&
              segment.id !== speaker!.receipt.segmentId,
          );
          target = speech?.id;
          return speech
            ? next.rules.segments.find(
                (rule) => rule.key === speech.rulesSegmentKey,
              )?.side
            : null;
        },
        { timeout: 10_000 },
      )
      .toBe('negative');
    if (!target) throw new Error('Actual opponent speech missing');
    const joined = speaker!.page.waitForResponse(
      (response) =>
        receiptResponse(round.id)(response) &&
        response.request().postDataJSON().segmentId === target,
    );
    await accounts.members[0]!.context.setOffline(false);
    const nextStamp = await receiptFrom(await joined);
    expect(nextStamp.segmentId).toBe(target);
    expect(nextStamp.participantId).toBe(speaker!.receipt.participantId);
    const facts = await attendanceEvidence(round.id);
    expect(
      facts.receipts.some(
        (receipt) =>
          receipt.segmentId === target &&
          receipt.participantId === speaker!.receipt.participantId &&
          receipt.receivedAt === nextStamp.receivedAt,
      ),
    ).toBe(true);
    expect(
      (await readBallotRound(accounts.members[1]!.context.request, round.id))
        .status,
    ).toBe('active');
  } finally {
    await accounts.closeContexts();
  }
});

for (const attendance of ['opponent-only', 'neither'] as const)
  test(`production attendance maintenance resolves ${attendance} from real HTTP receipts and settled public availability`, async ({
    browser,
  }) => {
    const accounts = await createRoomLaunchAccounts(browser, 4);
    try {
      const host = accounts.members[0]!.context;
      const round = await createHumanBallotRound(accounts.members);
      await actualSpeech(host.request, round.id);
      if (attendance === 'opponent-only')
        await enterSpeech(
          accounts.members[1]!.context,
          round.id,
          'present opponent',
        );
      await expect
        .poll(
          async () => (await readBallotRound(host.request, round.id)).status,
          { timeout: 60_000, intervals: [500] },
        )
        .toBe(attendance === 'neither' ? 'abandoned' : 'completed');
      const completed = await readBallotRound(host.request, round.id);
      expect(completed.outcome).toBe(
        attendance === 'neither' ? null : 'negative',
      );
      expect(completed.segments.at(-1)?.endedAt).toEqual(expect.any(String));
      const facts = await attendanceEvidence(round.id);
      expect(facts.adjudications.map((row) => row.decision)).toEqual([
        attendance === 'neither' ? 'abandoned' : 'forfeit',
      ]);
      expect(facts.ratingChanges).toBe(0);
      expect(facts.samples.some((sample) => sample.healthy)).toBe(true);
    } finally {
      await accounts.closeContexts();
    }
  });

test(
  'native explicit attendance crosses the original grace during a real public outage and refuses a finalized stale form',
  nativeAttendanceOutage,
);

for (const service of ['web', 'realtime'] as const)
  test(`whole ${service} outage postpones an actual speech and recovers without a false forfeit`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    await serviceAttendanceOutage(browser, service);
  });

test(
  'a real healthy web peer preserves public receipts and uninterrupted availability during rolling restart',
  rollingAttendancePeer,
);
