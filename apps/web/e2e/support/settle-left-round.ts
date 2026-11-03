import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { activeRoomReadSchema, isNamedSeat } from '@daisy/protocol';
import { currentRoundForfeit, readBallotRound } from './human-ballot-round';

/** The Round this member's active Room has launched, if it has one. */
const leftRoundId = async (request: APIRequestContext) => {
  const response = await request.get('/api/rooms/active');
  if (response.status() === 401) return null;
  if (!response.ok()) throw new Error(`Active Room read: ${response.status()}`);
  const { activeRoom } = activeRoomReadSchema.parse(await response.json());
  return activeRoom?.phase === 'live'
    ? (activeRoom.href.split('/')[2] ?? null)
    : null;
};

/** Forfeits for this member's seat, while there is still a debate to forfeit. */
export async function forfeitOwnSeat(
  request: APIRequestContext,
  roundId: string,
  matches: (seat: { role: string; slot: number; label: string }) => boolean,
) {
  const view = await readBallotRound(request, roundId);
  if (view.status !== 'opening' && view.status !== 'active') return;
  const debateOver =
    view.segments.filter((segment) => segment.endedAt !== null).length ===
    view.rules.segments.length;
  if (debateOver) return;
  const seat = view.participants.filter(isNamedSeat).find(matches);
  if (seat) await currentRoundForfeit(request, roundId, seat.id);
}

/**
 * A test that leaves its Round live leaves it running for minutes: each one
 * holds capture, attendance and recovery work on the competitive lane that the
 * next test's setup is then refused for (ISSUE-1217). This never fails a test:
 * a Round it cannot settle costs load, not correctness, and says so in the run's
 * output, so a settling that stops working does not hide as refusals later.
 */
async function settleLeftRound(member: {
  readonly context: BrowserContext;
  readonly username: string;
}) {
  const { request } = member.context;
  try {
    const roundId = await leftRoundId(request);
    if (roundId)
      await forfeitOwnSeat(
        request,
        roundId,
        (seat) =>
          seat.label === member.username &&
          (seat.role === 'affirmative' || seat.role === 'negative'),
      );
  } catch (error) {
    process.stderr.write(`Left Round not settled: ${String(error)}\n`);
  }
}

/** One at a time: one forfeit ends the Round, and the next member then finds none. */
export async function settleLeftRounds(
  members: readonly Parameters<typeof settleLeftRound>[0][],
) {
  for (const member of members) await settleLeftRound(member);
}
