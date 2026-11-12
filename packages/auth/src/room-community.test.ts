import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomStatuses } from '@daisy/protocol';
import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import { decideRoomCommunity } from './room-community';
setupRitewayBun();
const now = '2026-11-12T12:00:00.000Z';
const endedAt = '2026-11-12T11:00:00.000Z';
const principal = { userId: 'user', actorId: 'actor' };
const account = {
  ...principal,
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
  restricted: false,
};
const fact: RoomCommunityFact = {
  kind: 'room_community',
  roomId: 'room',
  channelId: null,
  policyKey: 'room.community',
  policyRevision: 1,
  revision: 2,
  status: 'assembling',
  visibility: 'public',
  endedAt: null,
  actorId: 'actor',
  standing: 'seated',
};
const actions = ['read', 'post', 'remove'] as const;
const standings = ['seated', 'visitor', null] as const;
const decide = (
  change: Partial<Parameters<typeof decideRoomCommunity>[0]> = {},
) =>
  decideRoomCommunity({
    principal,
    account,
    fact,
    action: 'read',
    now,
    ...change,
  });
const allowedActions = (
  change: Partial<Parameters<typeof decideRoomCommunity>[0]>,
) => actions.filter((action) => decide({ ...change, action }).allow);

describe('decideRoomCommunity', () => {
  test('every status, standing and action', () => {
    const table = Object.fromEntries(
      roomStatuses.flatMap((status) =>
        standings.map((standing) => [
          `${status}/${standing ?? 'none'}`,
          allowedActions({
            fact: {
              ...fact,
              status,
              standing,
              endedAt:
                status === 'assembling' || status === 'ready' ? null : endedAt,
            },
          }),
        ]),
      ),
    );
    assert({
      given: 'each Room status with each standing',
      should:
        'let a seated or visiting member read and post only while the Room is open, and leave own-message removal after it',
      actual: table,
      expected: {
        'assembling/seated': ['read', 'post', 'remove'],
        'assembling/visitor': ['read', 'post', 'remove'],
        'assembling/none': ['remove'],
        'ready/seated': ['read', 'post', 'remove'],
        'ready/visitor': ['read', 'post', 'remove'],
        'ready/none': ['remove'],
        'started/seated': ['remove'],
        'started/visitor': ['remove'],
        'started/none': ['remove'],
        'closed/seated': ['remove'],
        'closed/visitor': ['remove'],
        'closed/none': ['remove'],
      },
    });
  });
  test('what an allowed decision says', () => {
    assert({
      given: 'an open Room, and a removal after the Room ended',
      should:
        'be writable with no expiry while open, and read-only until 180 days after the end',
      actual: [
        decide({ action: 'post' }),
        decide({
          action: 'remove',
          fact: { ...fact, status: 'started', endedAt },
        }),
      ],
      expected: [
        { allow: true, readOnly: false, expiresAt: null },
        {
          allow: true,
          readOnly: true,
          expiresAt: '2027-05-11T11:00:00.000Z',
        },
      ],
    });
  });
  test('removal after the retention window', () => {
    const ended = { ...fact, status: 'closed' as const, endedAt };
    assert({
      given: 'an ended Room just before and exactly at 180 days after its end',
      should: 'allow own removal before the deadline and refuse it from then',
      actual: ['2027-05-11T10:59:59.999Z', '2027-05-11T11:00:00.000Z'].map(
        (instant) =>
          decide({ action: 'remove', fact: ended, now: instant }).allow,
      ),
      expected: [true, false],
    });
  });
  test('accounts that may not read or post', () => {
    const accounts = {
      missing: null,
      visitorOnly: { ...account, member: false },
      erased: { ...account, erased: true },
      unapproved: {
        ...account,
        beta: { state: 'pending' as const, revision: 1 },
      },
      revoked: { ...account, beta: { state: 'revoked' as const, revision: 1 } },
      noBeta: { ...account, beta: null },
      restricted: { ...account, restricted: true },
      noAge: { ...account, ageBand: null },
      underFloor: { ...account, ageBand: 'under-13' as const },
      foreignUser: { ...account, userId: 'foreign' },
      foreignActor: { ...account, actorId: 'foreign' },
      actorless: { ...account, actorId: null },
    };
    assert({
      given:
        'an account that is absent, not a member, erased, unapproved, restricted, under the age floor or not the principal',
      should:
        'refuse read and post, and keep removal only for a bound member who is not erased',
      actual: Object.fromEntries(
        Object.entries(accounts).map(([name, value]) => [
          name,
          allowedActions({ account: value as typeof account | null }),
        ]),
      ),
      expected: {
        missing: [],
        visitorOnly: [],
        erased: [],
        unapproved: ['remove'],
        revoked: ['remove'],
        noBeta: ['remove'],
        restricted: ['remove'],
        noAge: ['remove'],
        underFloor: ['remove'],
        foreignUser: [],
        foreignActor: [],
        actorless: [],
      },
    });
  });
  test('facts that are not this caller’s current authority', () => {
    const facts: Record<string, RoomCommunityFact> = {
      anotherActor: { ...fact, actorId: 'other' },
      anotherPolicy: { ...fact, policyKey: 'round.floor' as never },
      anotherPolicyRevision: { ...fact, policyRevision: 2 as never },
      noRevision: { ...fact, revision: 0 },
      unsafeRevision: { ...fact, revision: Number.MAX_SAFE_INTEGER + 1 },
      openButEnded: { ...fact, endedAt },
      endedWithoutInstant: { ...fact, status: 'started', endedAt: null },
      endedWithBadInstant: { ...fact, status: 'closed', endedAt: 'never' },
    };
    assert({
      given:
        'a fact for another actor or policy, or one that contradicts itself',
      should: 'refuse every action',
      actual: Object.fromEntries(
        Object.entries(facts).map(([name, value]) => [
          name,
          allowedActions({ fact: value }),
        ]),
      ),
      expected: Object.fromEntries(
        Object.keys(facts).map((name) => [name, []]),
      ),
    });
  });
  test('a clock that is not an instant', () => {
    assert({
      given: 'a now that does not parse',
      should: 'refuse every action',
      actual: allowedActions({ now: 'soon' }),
      expected: [],
    });
  });
  test('visibility alone', () => {
    assert({
      given:
        'a private Room whose fact still carries a standing, and a public one without',
      should:
        'decide from the standing the authority read produced, never from visibility',
      actual: [
        decide({ fact: { ...fact, visibility: 'private' } }).allow,
        decide({ fact: { ...fact, visibility: 'public', standing: null } })
          .allow,
      ],
      expected: [true, false],
    });
  });
});
