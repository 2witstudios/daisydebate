import { readRoundReply } from './round-read-reply';
import { foundationChoice, humanRoundSelection } from './human-round-selection';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import {
  affirmativeSide,
  judgeSeat,
  negativeSide,
  sameSeat,
  sideOfSeat,
  sideSeat,
  twoSideKeys,
  type SeatRef,
} from '@daisy/protocol/seats';
import { roomViewSchema } from '@daisy/protocol/room-read';
import { roundViewSchema, type RoundView } from '@daisy/protocol/round-view';
import { type RoomView } from '@daisy/protocol/room-contract';
import { createId } from '@paralleldrive/cuid2';
import { expect } from './fixtures';
import { origin } from './accounts';

type Member = { readonly context: BrowserContext; readonly username: string };
const roomCommand = async (
  request: APIRequestContext,
  view: RoomView,
  command: object,
) => {
  const response = await request.post(`/api/rooms/${view.id}/commands`, {
    headers: { origin },
    data: { ...command, commandId: createId(), expectedVersion: view.version },
  });
  expect(response.status()).toBe(200);
  return roomViewSchema.parse((await response.json()).view);
};
export const readBallotRound = async (
  request: APIRequestContext,
  roundId: string,
) => {
  // Only the canonical advertised temporary refusal permits another read.
  const response = await readRoundReply(() =>
    request.get(`/api/rounds/${roundId}`),
  );
  expect(response.status()).toBe(200);
  return roundViewSchema.parse(await response.json());
};
export const postRoundCommand = (
  request: APIRequestContext,
  roundId: string,
  expectedVersion: number,
  command: object,
) =>
  request.post(`/api/rounds/${roundId}/commands`, {
    headers: { origin },
    data: { version: 1, commandId: createId(), expectedVersion, command },
  });
/** The open segment a floor command names (INTX-7); a yield or point names it. */
export function openSequence(view: RoundView): number {
  const open = view.segments.find((segment) => segment.endedAt === null);
  if (!open) throw new Error('No open segment to name');
  return open.sequence;
}
export async function ballotRoundCommand(
  request: APIRequestContext,
  view: RoundView,
  command: object,
) {
  const response = await postRoundCommand(
    request,
    view.id,
    view.version,
    command,
  );
  expect(response.status()).toBe(200);
  return roundViewSchema.parse((await response.json()).view);
}
/**
 * Forfeits an active Round for a fixed seat at its current version.
 * Maintenance legitimately moves the Round on (it opens the first speech within
 * a tick of start), so a held view goes stale; a stale-version refusal wrote
 * nothing, and the forfeit is resent against a fresh read. Every other answer
 * is final (ISSUE-489). Only a forfeit for a named seat is safe to resend: a
 * resent yield would act on a later speech (ISSUE-489-r1).
 */
export async function currentRoundForfeit(
  request: APIRequestContext,
  roundId: string,
  participantId: string,
) {
  const command = { type: 'forfeit', participantId } as const;
  for (let attempt = 0; attempt < 5; attempt++) {
    const view = await readBallotRound(request, roundId);
    const response = await postRoundCommand(
      request,
      roundId,
      view.version,
      command,
    );
    const body = await response.json();
    if (response.status() === 409 && body.refusal === 'stale-version') continue;
    expect(response.status()).toBe(200);
    return roundViewSchema.parse(body.view);
  }
  throw new Error('The Round version moved past five fresh reads');
}
type Selection = ReturnType<typeof humanRoundSelection>;
/** A public Room from a proof format, the two-speech foundation by default, shaped by `select`. */
export async function createFoundationRoom(
  host: Member,
  select: (choice: typeof foundationChoice) => Selection,
  choice = foundationChoice,
) {
  const created = await host.context.request.post('/api/rooms', {
    headers: { origin },
    data: {
      commandId: createId(),
      title: 'Actual Round proof',
      resolution: { kind: 'custom', text: 'Cities should fund transit' },
      visibility: 'public',
      selection: select(choice),
      // Seats name sides: members[0] argues the Affirmative (ADR 0145).
      sides: 'fixed',
    },
  });
  expect(created.status()).toBe(201);
  return roomViewSchema.parse((await created.json()).view);
}
export const claimSeat = (member: Member, room: RoomView, seat: SeatRef) =>
  roomCommand(member.context.request, room, { type: 'claim-seat', seat });
export const assignSeat = (
  host: Member,
  room: RoomView,
  assignment: { readonly actorId: string; readonly seat: SeatRef },
) =>
  roomCommand(host.context.request, room, {
    type: 'assign-seat',
    ...assignment,
  });
/** The member's own fresh consent version, then Ready. */
export async function readyOwnSeat(
  member: Member,
  room: RoomView,
  seat: SeatRef,
) {
  const response = await member.context.request.get(`/api/rooms/${room.id}`);
  expect(response.status()).toBe(200);
  const own = roomViewSchema.parse(await response.json());
  const participant = own.participants.find(
    (p) => sameSeat(p.seat, seat) && 'consentVersion' in p,
  );
  if (!participant || !('consentVersion' in participant))
    throw new Error('Own actual consent missing');
  if (own.contentWaiver === 'unsigned')
    expect(
      (
        await member.context.request.post('/api/agreements/content-waiver', {
          data: {
            roomId: own.id,
            version: own.contentWaiverVersion,
            accepted: 'yes',
          },
        })
      ).status(),
    ).toBe(200);
  return roomCommand(member.context.request, own, {
    type: 'ready',
    expectedConsentVersion: participant.consentVersion,
    ...(own.captureNotice ? { noticeVersion: own.captureNotice.version } : {}),
  });
}
/** Launch, then the host's start command. */
export async function startAdmittedRound(host: Member, room: RoomView) {
  const launched = await roomCommand(host.context.request, room, {
    type: 'start-round',
  });
  if (!launched.roundRef) throw new Error('Round was not durably admitted');
  return readBallotRound(host.context.request, launched.roundRef.id);
}
/** Every seat claimed, then each member's own fresh consent. */
export async function seatAndReady(
  room: RoomView,
  seats: readonly {
    readonly member: Member;
    readonly seat: SeatRef;
  }[],
) {
  let current = room;
  for (const { member, seat } of seats)
    current = await claimSeat(member, current, seat);
  for (const { member, seat } of seats)
    current = await readyOwnSeat(member, current, seat);
  return current;
}

/** Actual authenticated Room admission and fresh consent; no fixture rows or invented authority. */
export async function createHumanBallotRound(
  members: readonly Member[],
  judgeSeats: 0 | 2 = 2,
  countdownMs = 0,
  choice = foundationChoice,
) {
  if (members.length !== 2 + judgeSeats)
    throw new Error('Human Round proof needs one member per seat');
  const host = members[0]!;
  let room = await createFoundationRoom(
    host,
    (proof) => humanRoundSelection(proof, judgeSeats, countdownMs),
    choice,
  );
  room = await seatAndReady(room, [
    { member: members[0]!, seat: sideSeat(affirmativeSide) },
    { member: members[1]!, seat: sideSeat(negativeSide) },
    ...members
      .slice(2)
      .map((member, slot) => ({ member, seat: judgeSeat(slot) })),
  ]);
  return startAdmittedRound(host, room);
}

/** Real first receipt and both voluntary speech endings; scheduler invocation is a separately labelled fixture edge. */
export async function playHumanBallotRound(
  members: readonly Member[],
  tick: (ids: readonly string[]) => Promise<void>,
) {
  let view = await createHumanBallotRound(members);
  for (const [index, side] of twoSideKeys.entries()) {
    await tick([view.id]);
    const request = members[index]!.context.request;
    view = await readBallotRound(request, view.id);
    const participant = view.participants.find(
      (seat) => sideOfSeat(seat.seat) === side && 'id' in seat,
    );
    if (!participant || !('id' in participant))
      throw new Error('Actual debater seat missing');
    if (index === 0) {
      const segment = view.segments.find(
        (segment) => segment.type === 'speech' && segment.endedAt === null,
      );
      if (!segment) throw new Error('Actual speech opening missing');
      const receipt = await request.post(`/api/rounds/${view.id}/check-in`, {
        headers: { origin },
        data: { version: 1, commandId: createId(), segmentId: segment.id },
      });
      expect(receipt.status()).toBe(200);
    }
    view = await ballotRoundCommand(request, view, {
      type: 'yield',
      participantId: participant.id,
      sequence: openSequence(view),
    });
  }
  return view;
}
