import { humanRoundSelection } from './human-round-selection';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import {
  roomCatalogChoiceSchema,
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
export async function ballotRoundCommand(
  request: APIRequestContext,
  view: RoundView,
  command: object,
) {
  const response = await request.post(`/api/rounds/${view.id}/commands`, {
    headers: { origin },
    data: {
      version: 1,
      commandId: createId(),
      expectedVersion: view.version,
      command,
    },
  });
  expect(response.status()).toBe(200);
  return roundViewSchema.parse((await response.json()).view);
}
/** Actual authenticated Room admission and fresh consent; no fixture rows or invented authority. */
export async function createHumanBallotRound(members: readonly Member[]) {
  if (members.length !== 4)
    throw new Error('Human ballot proof needs two debaters and two judges');
  const host = members[0]!;
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
      title: 'Actual human judge ballot proof',
      topic: 'Cities should fund transit',
      visibility: 'public',
      selection: humanRoundSelection(choice, 2),
    },
  });
  expect(created.status()).toBe(201);
  let room = roomViewSchema.parse((await created.json()).view);
  const seats = [
    { member: members[0]!, role: 'affirmative', slot: 0 },
    { member: members[1]!, role: 'negative', slot: 0 },
    { member: members[2]!, role: 'judge', slot: 0 },
    { member: members[3]!, role: 'judge', slot: 1 },
  ];
  for (const seat of seats)
    room = await roomCommand(seat.member.context.request, room, {
      type: 'claim-seat',
      role: seat.role,
      slot: seat.slot,
    });
  for (const seat of seats) {
    const response = await seat.member.context.request.get(
      `/api/rooms/${room.id}`,
    );
    expect(response.status()).toBe(200);
    const own = roomViewSchema.parse(await response.json());
    const participant = own.participants.find(
      (p) =>
        p.role === seat.role && p.slot === seat.slot && 'consentVersion' in p,
    );
    if (!participant || !('consentVersion' in participant))
      throw new Error('Own actual consent missing');
    room = await roomCommand(seat.member.context.request, own, {
      type: 'ready',
      expectedConsentVersion: participant.consentVersion,
    });
  }
  room = await roomCommand(host.context.request, room, { type: 'start-round' });
  if (!room.roundRef) throw new Error('Round was not durably admitted');
  const initial = await readBallotRound(host.context.request, room.roundRef.id);
  return ballotRoundCommand(host.context.request, initial, { type: 'start' });
}
