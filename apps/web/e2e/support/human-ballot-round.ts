import { humanRoundSelection } from './human-round-selection';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import {
  roomCatalogChoiceSchema,
  type RoomCatalogChoice,
  roomViewSchema,
  roundViewSchema,
  type RoomView,
  type RoundView,
} from '@daisy/protocol';
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
  const response = await request.get(`/api/rounds/${roundId}`);
  expect(response.status()).toBe(200);
  return roundViewSchema.parse(await response.json());
};
const postRoundCommand = (
  request: APIRequestContext,
  roundId: string,
  expectedVersion: number,
  command: object,
) =>
  request.post(`/api/rounds/${roundId}/commands`, {
    headers: { origin },
    data: { version: 1, commandId: createId(), expectedVersion, command },
  });
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
/** A public Room from the actual catalog foundation, shaped by `select`. */
export async function createFoundationRoom(
  host: Member,
  select: (choice: RoomCatalogChoice) => Selection,
) {
  const catalog = await host.context.request.get('/api/rooms/catalog');
  expect(catalog.status()).toBe(200);
  const choices = (await catalog.json()).choices.map((choice: unknown) =>
    roomCatalogChoiceSchema.parse(choice),
  );
  const choice = choices.find(
    (item: { formatId: string }) => item.formatId === 'foundation',
  );
  if (!choice) throw new Error('Actual foundation format missing');
  const created = await host.context.request.post('/api/rooms', {
    headers: { origin },
    data: {
      commandId: createId(),
      title: 'Actual Round proof',
      topic: 'Cities should fund transit',
      visibility: 'public',
      selection: select(choice),
    },
  });
  expect(created.status()).toBe(201);
  return roomViewSchema.parse((await created.json()).view);
}
export const claimSeat = (member: Member, room: RoomView, seat: object) =>
  roomCommand(member.context.request, room, { type: 'claim-seat', ...seat });
export const assignSeat = (host: Member, room: RoomView, seat: object) =>
  roomCommand(host.context.request, room, { type: 'assign-seat', ...seat });
/** The member's own fresh consent version, then Ready. */
export async function readyOwnSeat(
  member: Member,
  room: RoomView,
  seat: { readonly role: string; readonly slot: number },
) {
  const response = await member.context.request.get(`/api/rooms/${room.id}`);
  expect(response.status()).toBe(200);
  const own = roomViewSchema.parse(await response.json());
  const participant = own.participants.find(
    (p) =>
      p.role === seat.role && p.slot === seat.slot && 'consentVersion' in p,
  );
  if (!participant || !('consentVersion' in participant))
    throw new Error('Own actual consent missing');
  return roomCommand(member.context.request, own, {
    type: 'ready',
    expectedConsentVersion: participant.consentVersion,
  });
}
/** Launch, then the host's start command. */
export async function startAdmittedRound(host: Member, room: RoomView) {
  const launched = await roomCommand(host.context.request, room, {
    type: 'start-round',
  });
  if (!launched.roundRef) throw new Error('Round was not durably admitted');
  const initial = await readBallotRound(
    host.context.request,
    launched.roundRef.id,
  );
  return ballotRoundCommand(host.context.request, initial, { type: 'start' });
}
/** Actual authenticated Room admission and fresh consent; no fixture rows or invented authority. */
export async function createHumanBallotRound(
  members: readonly Member[],
  judgeSeats: 0 | 2 = 2,
) {
  if (members.length !== 2 + judgeSeats)
    throw new Error('Human Round proof needs one member per seat');
  const host = members[0]!;
  let room = await createFoundationRoom(host, (choice) =>
    humanRoundSelection(choice, judgeSeats),
  );
  const seats = [
    { member: members[0]!, role: 'affirmative', slot: 0 },
    { member: members[1]!, role: 'negative', slot: 0 },
    ...members
      .slice(2)
      .map((member, slot) => ({ member, role: 'judge', slot })),
  ];
  for (const { member, ...seat } of seats)
    room = await claimSeat(member, room, seat);
  for (const { member, ...seat } of seats)
    room = await readyOwnSeat(member, room, seat);
  return startAdmittedRound(host, room);
}

/** Real first receipt and both voluntary speech endings; scheduler invocation is a separately labelled fixture edge. */
export async function playHumanBallotRound(
  members: readonly Member[],
  tick: (ids: readonly string[]) => Promise<void>,
) {
  let view = await createHumanBallotRound(members);
  for (const [index, role] of (
    ['affirmative', 'negative'] as const
  ).entries()) {
    await tick([view.id]);
    const request = members[index]!.context.request;
    view = await readBallotRound(request, view.id);
    const participant = view.participants.find(
      (seat) => seat.role === role && 'id' in seat,
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
    });
  }
  return view;
}
