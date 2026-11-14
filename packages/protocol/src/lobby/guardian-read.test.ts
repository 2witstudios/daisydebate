import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  guardianReadCatalogue,
  guardianViewSchema,
  wardAccountViewSchema,
  wardEntryRequestViewSchema,
} from './guardian-read';

setupRitewayBun();

const id = (word: string) => word.padEnd(24, '0');
const ward = { id: id('ada'), handle: 'ada', name: 'Ada', age: 13 };
const lobby = {
  id: id('capital'),
  handle: 'capital-city-classic',
  name: 'Capital City Classic',
};

const guardian = {
  requests: [
    {
      entryId: id('entry'),
      ward: { id: ward.id, handle: ward.handle, name: ward.name },
      lobby,
      startsAt: '2026-12-05T09:00:00.000Z',
      enteredBy: { name: 'Marta Silva', relation: 'coach' },
    },
  ],
  wards: [
    {
      ward,
      linkStatus: 'active',
      allowedLobbyCount: 2,
      capabilities: { manageAccount: true },
      entries: [
        {
          id: id('entry'),
          lobby,
          eventName: 'Impromptu',
          partnerNames: [],
          awaitingGuardian: true,
          timing: { kind: 'upcoming', startsAt: '2026-12-05T09:00:00.000Z' },
        },
        {
          id: id('entrytoday'),
          lobby: { ...lobby, id: id('autumn'), handle: 'autumn-open' },
          eventName: 'Impromptu',
          partnerNames: [],
          awaitingGuardian: false,
          timing: { kind: 'today', now: 'speaking now' },
        },
      ],
    },
  ],
};

const account = {
  ward,
  consentedAt: '2026-09-02T10:00:00.000Z',
  lobbies: [
    {
      id: id('southeast'),
      name: 'Southeast League',
      description: null,
      allowed: true,
    },
  ],
  videoAudienceCap: 'officials',
  capabilities: { manage: true },
};

const request = {
  entryId: id('entry'),
  ward: { id: ward.id, handle: ward.handle, name: ward.name },
  tournament: {
    ...lobby,
    startsAt: '2026-12-05T09:00:00.000Z',
    place: 'online',
    organizerName: 'Capital Debate League',
    recordedFor: 'officials',
  },
  enteredBy: {
    name: 'Marta Silva',
    relation: 'coach',
    organizationName: 'Homeschool Forensics Circle',
  },
  event: { name: 'Impromptu', summary: 'Three rounds and a final' },
  videoAudienceCap: 'lobby',
  capabilities: { decide: true },
};

describe('guardian reads', async () => {
  test('each read parses', () => {
    assert({
      given: 'a family, a ward account and an entry waiting on the guardian',
      should: 'parse each unchanged',
      actual: [
        parseOutcome(guardianViewSchema, guardian),
        parseOutcome(wardAccountViewSchema, account),
        parseOutcome(wardEntryRequestViewSchema, request),
      ],
      expected: [{ data: guardian }, { data: account }, { data: request }],
    });
  });

  test('a ward is a minor', () => {
    assert({
      given: 'a ward of eighteen',
      should: 'refuse the age',
      actual: parseOutcome(wardAccountViewSchema, {
        ...account,
        ward: { ...ward, age: 18 },
      }),
      expected: { issues: ['ward.age'] },
    });
  });

  test('a video cap is a closed value', () => {
    assert({
      given: 'a cap outside officials and lobby',
      should: 'refuse it',
      actual: parseOutcome(wardAccountViewSchema, {
        ...account,
        videoAudienceCap: 'public',
      }),
      expected: { issues: ['videoAudienceCap'] },
    });
  });

  test('a strict shape', () => {
    assert({
      given: "a ward carrying the guardian's email",
      should: 'refuse the unknown field',
      actual: parseOutcome(wardAccountViewSchema, {
        ...account,
        ward: { ...ward, email: 'n@example.com' },
      }),
      expected: { issues: ['ward'] },
    });
  });

  test('gates', () => {
    assert({
      given: 'the guardian reads',
      should: 'gate each on guardian.link.read',
      actual: Object.values(guardianReadCatalogue).map((read) => read.gate),
      expected: [
        ['guardian.link.read'],
        ['guardian.link.read'],
        ['guardian.link.read'],
      ],
    });
  });
});
