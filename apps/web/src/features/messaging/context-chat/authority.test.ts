import { decideRoomCommunity } from '@daisy/auth/room-community';
import { isAppError } from '@daisy/errors';
import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextChatFence } from './authority';

setupRitewayBun();
const caller = { userId: 'user', actorId: 'actor' };
const actions = ['read', 'post', 'remove'] as const;
const answer = async (work: Promise<void>) => {
  try {
    await work;
    return 'allowed';
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
};
const answers = (
  scope: typeof caller,
  allows: Parameters<typeof contextChatFence>[1],
) =>
  Promise.all(
    actions.map((action) =>
      answer(
        contextChatFence(
          caller,
          allows,
        )({ scope, fact: null, account: null, action }),
      ),
    ),
  );

test('a context chat refusal', async () => {
  assert({
    given:
      'a read, a post and a removal that the context allows, that it refuses, and that are asked for someone other than the caller',
    should:
      'pass what is allowed, answer a refused post as forbidden and anything else as not found, and never ask for another caller',
    actual: [
      await answers(caller, () => true),
      await answers(caller, () => false),
      await answers({ ...caller, actorId: 'other' }, () => true),
      await answers({ ...caller, userId: 'other' }, () => true),
    ],
    expected: [
      ['allowed', 'allowed', 'allowed'],
      ['NOT_FOUND', 'AUTHORIZATION', 'NOT_FOUND'],
      ['NOT_FOUND', 'AUTHORIZATION', 'NOT_FOUND'],
      ['NOT_FOUND', 'AUTHORIZATION', 'NOT_FOUND'],
    ],
  });
});

test('a judge who reads Room chat and may not post in it', async () => {
  const fact: RoomCommunityFact = {
    kind: 'room_community',
    roomId: 'room',
    channelId: 'channel',
    policyKey: 'room.community',
    policyRevision: 1,
    revision: 2,
    status: 'assembling',
    visibility: 'private',
    endedAt: null,
    actorId: caller.actorId,
    host: true,
    seatRole: 'judge',
  };
  const account = {
    ...caller,
    member: true,
    erased: false,
    revision: 1,
    beta: { state: 'approved' as const, revision: 1 },
    ageBand: 'adult' as const,
    restricted: false,
  };
  const fence = contextChatFence(
    caller,
    (input: {
      readonly fact: RoomCommunityFact;
      readonly account: typeof account;
      readonly action: (typeof actions)[number];
    }) =>
      decideRoomCommunity({
        principal: caller,
        ...input,
        now: '2026-11-12T12:00:00.000Z',
      }).allow,
  );
  assert({
    given: 'a host seated as judge, under Room chat’s own decision',
    should:
      'pass the read and the removal and answer the post as forbidden, not as a missing chat',
    actual: await Promise.all(
      actions.map((action) =>
        answer(fence({ scope: caller, fact, account, action })),
      ),
    ),
    expected: ['allowed', 'AUTHORIZATION', 'allowed'],
  });
});
