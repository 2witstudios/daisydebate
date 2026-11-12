import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import { decideRoomCommunityPermit } from './room-community-viewer';
setupRitewayBun();
const principal = { actorId: 'actor', userId: 'user', sessionId: 'session' };
const instant = '2026-11-12T00:00:00.000Z';
const account = {
  userId: 'user',
  actorId: 'actor',
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
  restricted: false,
};
const session = {
  ...principal,
  account,
  expiresAt: '2026-11-13T00:00:00.000Z',
};
const fact: RoomCommunityFact = {
  kind: 'room_community',
  roomId: 'room',
  channelId: 'channel',
  policyKey: 'room.community',
  policyRevision: 1,
  revision: 5,
  status: 'assembling',
  visibility: 'public',
  endedAt: null,
  actorId: 'actor',
  standing: 'visitor',
};
const input = {
  principal,
  session,
  fact,
  contentRevision: 8,
  started: 100,
  now: 100,
  instant,
};
const denied = { status: 'denied' as const };
describe('Room chat observation permits', () => {
  test('a seated or visiting member of an open Room', () =>
    assert({
      given: 'an eligible visitor and seat of an open Room',
      should:
        'issue each the same standard short permit with the exact disclosure revision and content floor',
      actual: (['visitor', 'seated'] as const).map((standing) =>
        decideRoomCommunityPermit({ ...input, fact: { ...fact, standing } }),
      ),
      expected: [1, 2].map(() => ({
        status: 'allowed' as const,
        partition: 'members',
        disclosureRevision: 5,
        minimumContentRevision: 8,
        validUntil: 4800,
      })),
    }));
  test('a session about to end', () =>
    assert({
      given: 'a session that ends one second after the read',
      should: 'bound the permit at the session, never past it',
      actual: decideRoomCommunityPermit({
        ...input,
        session: { ...session, expiresAt: '2026-11-12T00:00:01.000Z' },
      }),
      expected: {
        status: 'allowed',
        partition: 'members',
        disclosureRevision: 5,
        minimumContentRevision: 8,
        validUntil: 1100,
      },
    }));
  test('the moment authority ends', () =>
    assert({
      given:
        'a Room that started, one that closed, a viewer with no standing, a revoked session, a restricted account and an erased one',
      should: 'deny each without a projection grant',
      actual: [
        decideRoomCommunityPermit({
          ...input,
          fact: { ...fact, status: 'started', endedAt: instant },
        }),
        decideRoomCommunityPermit({
          ...input,
          fact: {
            ...fact,
            standing: 'seated',
            status: 'closed',
            endedAt: instant,
          },
        }),
        decideRoomCommunityPermit({
          ...input,
          fact: { ...fact, visibility: 'private', standing: null },
        }),
        decideRoomCommunityPermit({ ...input, session: null }),
        decideRoomCommunityPermit({
          ...input,
          session: { ...session, account: { ...account, restricted: true } },
        }),
        decideRoomCommunityPermit({
          ...input,
          session: { ...session, account: { ...account, erased: true } },
        }),
      ],
      expected: [denied, denied, denied, denied, denied, denied],
    }));
  test('a fact for someone else', () =>
    assert({
      given: 'a fact read for another actor',
      should: 'deny: a permit is only ever this viewer’s own authority',
      actual: decideRoomCommunityPermit({
        ...input,
        fact: { ...fact, actorId: 'other' },
      }),
      expected: denied,
    }));
});
