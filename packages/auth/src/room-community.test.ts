import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomStatuses } from '@daisy/protocol';
import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import { decideRoomCommunity, roomCommunityStanding } from './room-community';
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
  host: false,
  seatRole: 'affirmative',
};
const actions = ['read', 'post', 'remove'] as const;
const visibilities = ['public', 'unlisted', 'private'] as const;
const seatRoles = ['affirmative', 'negative', 'judge', null] as const;
/** One caller of each standing, as raw facts. */
const callers = {
  seated: { host: false, seatRole: 'negative' },
  host: { host: true, seatRole: null },
  visitor: { host: false, seatRole: null },
  judge: { host: false, seatRole: 'judge' },
  hostJudge: { host: true, seatRole: 'judge' },
  none: { host: false, seatRole: null, visibility: 'private' },
} as const;
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
  test('the standing of every visibility, host and seat', () => {
    assert({
      given: 'each visibility with each seat, for the host and for anyone else',
      should:
        'make a judge seat a judge whoever hosts, the host and debaters seated, a seatless reader of a public or unlisted Room a visitor, and a seatless stranger to a private Room nothing',
      actual: Object.fromEntries(
        visibilities.flatMap((visibility) =>
          [true, false].flatMap((host) =>
            seatRoles.map((seatRole) => [
              `${visibility}/${host ? 'host' : 'other'}/${seatRole ?? 'no seat'}`,
              roomCommunityStanding({ visibility, host, seatRole }),
            ]),
          ),
        ),
      ),
      expected: Object.fromEntries(
        visibilities.flatMap((visibility) => [
          [`${visibility}/host/affirmative`, 'seated'],
          [`${visibility}/host/negative`, 'seated'],
          [`${visibility}/host/judge`, 'judge'],
          [`${visibility}/host/no seat`, 'seated'],
          [`${visibility}/other/affirmative`, 'seated'],
          [`${visibility}/other/negative`, 'seated'],
          [`${visibility}/other/judge`, 'judge'],
          [
            `${visibility}/other/no seat`,
            visibility === 'private' ? null : 'visitor',
          ],
        ]),
      ),
    });
  });
  test('every status, standing and action', () => {
    const table = Object.fromEntries(
      roomStatuses.flatMap((status) =>
        Object.entries(callers).map(([name, caller]) => [
          `${status}/${name}`,
          allowedActions({
            fact: {
              ...fact,
              ...caller,
              status,
              endedAt:
                status === 'assembling' || status === 'ready' ? null : endedAt,
            },
          }),
        ]),
      ),
    );
    const open = {
      seated: ['read', 'post', 'remove'],
      host: ['read', 'post', 'remove'],
      visitor: ['read', 'post', 'remove'],
      judge: ['read', 'remove'],
      hostJudge: ['read', 'remove'],
      none: ['remove'],
    };
    assert({
      given: 'each Room status with each standing',
      should:
        'let everyone with a standing read and all but a judge post only while the Room is open, and leave own-message removal after it',
      actual: table,
      expected: Object.fromEntries(
        roomStatuses.flatMap((status) =>
          Object.entries(open).map(([name, allowed]) => [
            `${status}/${name}`,
            status === 'assembling' || status === 'ready'
              ? allowed
              : ['remove'],
          ]),
        ),
      ),
    });
  });
  test('what an allowed decision says', () => {
    assert({
      given:
        'an open Room for a debater and for a judge, and a removal after the Room ended',
      should:
        'be writable with no expiry while open, read-only for the judge, and read-only until 180 days after the end',
      actual: [
        decide({ action: 'post' }),
        decide({ action: 'read', fact: { ...fact, ...callers.hostJudge } }),
        decide({
          action: 'remove',
          fact: { ...fact, status: 'started', endedAt },
        }),
      ],
      expected: [
        { allow: true, readOnly: false, expiresAt: null },
        { allow: true, readOnly: true, expiresAt: null },
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
  test('a Room whose visibility changes', () => {
    const visitor = { ...fact, ...callers.visitor };
    assert({
      given:
        'a seatless member of a public Room, the same Room made private, and its seats and host then',
      should:
        'admit the visitor only while the Room is theirs to read, and keep the host and the seats',
      actual: [
        allowedActions({ fact: visitor }),
        allowedActions({ fact: { ...visitor, visibility: 'private' } }),
        allowedActions({ fact: { ...fact, visibility: 'private' } }),
        allowedActions({
          fact: { ...fact, ...callers.host, visibility: 'private' },
        }),
        allowedActions({
          fact: { ...fact, ...callers.judge, visibility: 'private' },
        }),
      ],
      expected: [
        ['read', 'post', 'remove'],
        ['remove'],
        ['read', 'post', 'remove'],
        ['read', 'post', 'remove'],
        ['read', 'remove'],
      ],
    });
  });
});
