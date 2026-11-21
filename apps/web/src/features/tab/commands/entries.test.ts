import type { EntryCommand } from '@daisy/protocol/lobby/entry-command';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  decideEntry,
  type EntryDecision,
  type EntryFacts,
  type EntryPersonFacts,
  type EntryRowFacts,
} from './entries';

setupRitewayBun();

const id = (tag: string) => tag.padEnd(24, '0');
const lobbyId = id('lobby');
const eventId = id('event');
const entryId = id('entry');
const coach = id('coachuser');
const parent = id('parentuser');

const person = (
  name: string,
  overrides: Partial<EntryPersonFacts> = {},
): EntryPersonFacts => ({
  actorId: id(`actor${name}`),
  userId: id(`user${name}`),
  minor: false,
  withinAgeBand: true,
  divisions: ['Novice', 'Open'],
  enteredInEvent: false,
  enteredInSharedSlot: false,
  bandOnFirstDay: 'adult',
  ...overrides,
});
const ada = person('ada');
const ben = person('ben');
/** A minor entrant. */
const minor = person('min', {
  minor: true,
});

const entry = (overrides: Partial<EntryRowFacts> = {}): EntryRowFacts => ({
  id: entryId,
  status: 'pending',
  division: 'Novice',
  responsibleKind: 'school',
  guardianUserId: null,
  submittedByUserId: null,
  version: 1,
  members: [ada, ben],
  liveFixtures: [],
  breakChoice: { open: true, qualified: [] },
  ...overrides,
});

const facts = (overrides: Partial<EntryFacts> = {}): EntryFacts => ({
  commandId: id('command'),
  now: '2026-11-14T12:00:00.000Z',
  newEntryId: id('newentry'),
  event: {
    id: eventId,
    lobbyId,
    entriesVersion: 7,
    divisions: ['Novice', 'Open'],
    approval: 'host',
    entryCap: null,
    entryCount: 3,
    ageDivision: 'open',
    registration: { opensAt: null, closesAt: '2026-11-20T00:00:00.000Z' },
    started: false,
  },
  sender: { userId: coach, host: false },
  people: [ada, ben, minor],
  responsible: {
    kind: 'school',
    schoolOrganizationId: id('school'),
    found: true,
  },
  entry: entry(),
  hosting: { tier: 'free', acceptedEntries: 3 },
  ...overrides,
});

const submit = (
  overrides: Partial<Extract<EntryCommand, { type: 'submit-entry' }>> = {},
): EntryCommand => ({
  type: 'submit-entry',
  eventId,
  name: 'Lincoln AB',
  memberActorIds: [ada.actorId, ben.actorId],
  responsible: { kind: 'school', schoolOrganizationId: id('school') },
  division: 'Novice',
  ...overrides,
});

const refusalOf = (decision: EntryDecision) =>
  decision.kind === 'refused' ? decision.refusal : 'accepted';
const writesOf = (decision: EntryDecision) =>
  decision.kind === 'accepted' ? decision.writes : [];
const insertedEntry = (decision: EntryDecision) =>
  writesOf(decision).find(
    (write) => write.table === 'entries' && write.op === 'insert',
  );

describe('submit-entry', () => {
  test('a submission requires an authenticated maker even under host authority', () => {
    assert({
      given: 'a submit-entry decision without an authenticated account',
      should: 'refuse without writing an entry with unknown provenance',
      actual: decideEntry(
        facts({ sender: { userId: null, host: true } }),
        submit(),
      ),
      expected: { kind: 'refused', refusal: 'not-found' },
    });
  });
  test('an entry carries its division and responsible adult', () => {
    const decision = decideEntry(facts(), submit());
    assert({
      given: 'a coach entering two people in the Novice division',
      should:
        'insert a pending entry with its division, its members and a new entries version',
      actual: {
        version:
          decision.kind === 'accepted' ? decision.resultingVersion : null,
        entry: insertedEntry(decision),
        members: writesOf(decision).filter(
          (write) => write.table === 'entry_members',
        ).length,
      },
      expected: {
        version: 8,
        entry: {
          table: 'entries',
          op: 'insert',
          row: {
            id: id('newentry'),
            lobbyId,
            eventId,
            name: 'Lincoln AB',
            submittedByUserId: coach,
            status: 'pending',
            division: 'Novice',
            responsibleKind: 'school',
            schoolOrganizationId: id('school'),
            guardianLinkId: null,
          },
        },
        members: 2,
      },
    });
  });

  test('an automatic approval or a host accepts at once', () => {
    const statusOf = (decision: EntryDecision) => {
      const write = insertedEntry(decision);
      return write?.op === 'insert' && write.table === 'entries'
        ? write.row.status
        : null;
    };
    assert({
      given: 'automatic approval, and separately a host sending it',
      should: 'insert the entry accepted',
      actual: [
        statusOf(
          decideEntry(
            facts({ event: { ...facts().event, approval: 'automatic' } }),
            submit(),
          ),
        ),
        statusOf(
          decideEntry(
            facts({ sender: { userId: coach, host: true } }),
            submit(),
          ),
        ),
      ],
      expected: ['accepted', 'accepted'],
    });
  });

  test('each rule refuses by name', () => {
    const base = facts();
    assert({
      given: 'a submission breaking one rule at a time',
      should: 'name the refusal',
      actual: [
        decideEntry(facts({ now: '2026-11-21T00:00:00.000Z' }), submit()),
        decideEntry(
          facts({ people: [{ ...ada, enteredInEvent: true }, ben] }),
          submit(),
        ),
        decideEntry(
          facts({ people: [{ ...ada, withinAgeBand: false }, ben] }),
          submit(),
        ),
        decideEntry(
          facts({ responsible: { kind: 'self' } }),
          submit({ responsible: { kind: 'self' } }),
        ),
        decideEntry(base, submit({ division: 'Varsity' })),
        decideEntry(
          facts({ people: [{ ...ada, divisions: ['Open'] }, ben] }),
          submit(),
        ),
        decideEntry(facts({ event: { ...base.event, entryCap: 3 } }), submit()),
        decideEntry(
          facts({ people: [{ ...ada, enteredInSharedSlot: true }, ben] }),
          submit(),
        ),
        decideEntry(base, submit({ eventId: id('otherevent') })),
      ].map(refusalOf),
      expected: [
        'registration-closed',
        'already-entered',
        'age-band',
        'no-responsible-adult',
        'division-unknown',
        'division-ineligible',
        'entry-cap',
        'slot-clash',
        'not-found',
      ],
    });
  });

  test('an adult enters themselves; a guardian enters their ward', () => {
    const self = facts({
      sender: { userId: ada.userId, host: false },
      responsible: { kind: 'self' },
    });
    const guardian = facts({
      sender: { userId: parent, host: false },
      responsible: {
        kind: 'guardian',
        guardianLinkId: id('link'),
        guardianUserId: parent,
        minorUserId: minor.userId!,
        active: true,
      },
    });
    assert({
      given:
        'a self entry by the adult, a self entry for a minor, and a guardian entering their ward',
      should: 'accept the adult and the guardian, refuse the minor',
      actual: [
        decideEntry(
          self,
          submit({
            memberActorIds: [ada.actorId],
            responsible: { kind: 'self' },
          }),
        ),
        decideEntry(
          facts({
            sender: { userId: minor.userId, host: false },
            responsible: { kind: 'self' },
          }),
          submit({
            memberActorIds: [minor.actorId],
            responsible: { kind: 'self' },
          }),
        ),
        decideEntry(
          guardian,
          submit({
            memberActorIds: [minor.actorId],
            responsible: { kind: 'guardian', guardianLinkId: id('link') },
          }),
        ),
      ].map(refusalOf),
      expected: ['accepted', 'no-responsible-adult', 'accepted'],
    });
  });
});

describe('the event division (PYL-16)', () => {
  const youth = (overrides: Partial<EntryFacts> = {}) =>
    facts({ event: { ...facts().event, ageDivision: 'youth' }, ...overrides });
  test('an entrant outside the division is refused at registration, with the reason', () => {
    const adult = person('ada', { bandOnFirstDay: 'adult' });
    const sixteen = person('ada', { bandOnFirstDay: '16-17' });
    assert({
      given:
        'a Youth event with an entrant who is 18 on its first day, and an Open event with one who is 16',
      should: 'refuse them as over the Youth age and under the Open age',
      actual: [
        refusalOf(decideEntry(youth({ people: [adult, ben] }), submit())),
        refusalOf(decideEntry(facts({ people: [sixteen, ben] }), submit())),
      ],
      expected: ['over-youth-age', 'under-open-age'],
    });
    assert({
      given: 'a Youth event with entrants who are 16 and 17 on its first day',
      should: 'accept the submission',
      actual: refusalOf(
        decideEntry(
          youth({
            people: [
              person('ada', { bandOnFirstDay: '16-17', minor: true }),
              person('ben', { bandOnFirstDay: '16-17', minor: true }),
            ],
          }),
          submit(),
        ),
      ),
      expected: 'accepted',
    });
  });
  test('a replacement member is held to the division too', () => {
    assert({
      given:
        'a Youth event whose entry swaps in someone who is 18 on its first day',
      should: 'refuse the replacement as over the Youth age',
      actual: refusalOf(
        decideEntry(
          youth({
            people: [person('cat', { bandOnFirstDay: 'adult' })],
            entry: entry({ status: 'accepted' }),
          }),
          {
            type: 'replace-entry-member',
            entryId,
            outActorId: ada.actorId,
            inActorId: person('cat').actorId,
          },
        ),
      ),
      expected: 'over-youth-age',
    });
  });
});

describe('the hosting tier entry cap (PYL-14)', () => {
  const statusOf = (decision: EntryDecision) => {
    const write = insertedEntry(decision);
    return write?.op === 'insert' && write.table === 'entries'
      ? write.row.status
      : refusalOf(decision);
  };
  const automatic = (
    tier: 'free' | 'event_64' | 'event_unlimited',
    acceptedEntries: number,
  ) =>
    facts({
      event: { ...facts().event, approval: 'automatic' },
      hosting: { tier, acceptedEntries },
    });
  test('a submission past the cap waits for the host', () => {
    assert({
      given:
        'automatic approval on a free tournament with 15 and then 16 accepted entries',
      should: 'accept the 16th and hold the 17th as pending',
      actual: [
        statusOf(decideEntry(automatic('free', 15), submit())),
        statusOf(decideEntry(automatic('free', 16), submit())),
      ],
      expected: ['accepted', 'pending'],
    });
    assert({
      given: 'a USD 99 tournament with 63 and then 64 accepted entries',
      should: 'accept the 64th and hold the 65th as pending',
      actual: [
        statusOf(decideEntry(automatic('event_64', 63), submit())),
        statusOf(decideEntry(automatic('event_64', 64), submit())),
      ],
      expected: ['accepted', 'pending'],
    });
    assert({
      given: 'the host entering a 17th on a free tournament',
      should: 'hold it as pending too',
      actual: statusOf(
        decideEntry(
          facts({
            sender: { userId: coach, host: true },
            hosting: { tier: 'free', acceptedEntries: 16 },
          }),
          submit(),
        ),
      ),
      expected: 'pending',
    });
    assert({
      given: 'an unlimited tournament with 500 accepted entries',
      should: 'accept another at once',
      actual: statusOf(
        decideEntry(automatic('event_unlimited', 500), submit()),
      ),
      expected: 'accepted',
    });
  });
  test('accepting past the cap needs an upgrade', () => {
    const accept = { type: 'accept-entry', entryId } as const;
    assert({
      given: 'a free tournament at 15 and then at 16 accepted entries',
      should: 'accept the 16th and refuse the 17th',
      actual: [
        refusalOf(
          decideEntry(
            facts({ hosting: { tier: 'free', acceptedEntries: 15 } }),
            accept,
          ),
        ),
        refusalOf(
          decideEntry(
            facts({ hosting: { tier: 'free', acceptedEntries: 16 } }),
            accept,
          ),
        ),
      ],
      expected: ['accepted', 'hosting-upgrade-required'],
    });
    assert({
      given: 'a USD 99 tournament at 64 accepted entries',
      should: 'refuse the 65th',
      actual: refusalOf(
        decideEntry(
          facts({ hosting: { tier: 'event_64', acceptedEntries: 64 } }),
          accept,
        ),
      ),
      expected: 'hosting-upgrade-required',
    });
    assert({
      given: 'a league tournament, which has no hosting tier',
      should: 'accept with no cap',
      actual: refusalOf(
        decideEntry(
          facts({
            hosting: null,
            event: { ...facts().event, entryCount: 900 },
          }),
          accept,
        ),
      ),
      expected: 'accepted',
    });
  });
});

describe('settling an entry', () => {
  test('accept, decline and withdraw refuse a settled entry', () => {
    const accepted = facts({ entry: entry({ status: 'accepted' }) });
    const withdrawn = facts({ entry: entry({ status: 'withdrawn' }) });
    assert({
      given:
        'settling commands on settled entries, and an accept with a slot clash',
      should: 'name each refusal',
      actual: [
        decideEntry(accepted, { type: 'accept-entry', entryId }),
        decideEntry(accepted, { type: 'decline-entry', entryId }),
        decideEntry(withdrawn, {
          type: 'withdraw-entry',
          entryId,
          reason: 'Ill',
        }),
        decideEntry(
          facts({
            entry: entry({ members: [{ ...ada, enteredInSharedSlot: true }] }),
          }),
          { type: 'accept-entry', entryId },
        ),
        decideEntry(facts({ entry: null }), { type: 'accept-entry', entryId }),
      ].map(refusalOf),
      expected: [
        'entry-settled',
        'entry-settled',
        'entry-settled',
        'slot-clash',
        'not-found',
      ],
    });
  });

  test('a decline and a withdrawal withdraw the entry', () => {
    const status = (decision: EntryDecision) =>
      writesOf(decision).flatMap((write) =>
        write.table === 'entries' && write.op === 'update' ? [write.set] : [],
      );
    assert({
      given: 'a pending entry declined, and an accepted one withdrawn',
      should: 'set each withdrawn',
      actual: [
        status(decideEntry(facts(), { type: 'decline-entry', entryId })),
        status(
          decideEntry(facts({ entry: entry({ status: 'accepted' }) }), {
            type: 'withdraw-entry',
            entryId,
            reason: 'Ill',
          }),
        ),
      ],
      expected: [[{ status: 'withdrawn' }], [{ status: 'withdrawn' }]],
    });
  });
});

describe('replace-entry-member', () => {
  const cara = person('cara');
  const live = (state: 'open' | 'round_live') => ({
    fixtureId: id('fixture'),
    tabRoundId: id('round'),
    roomId: id('room'),
    timeSlot: { id: id('slot'), version: 2 },
    state,
    people: [ada.actorId, ben.actorId, id('judge')],
  });
  const replace: EntryCommand = {
    type: 'replace-entry-member',
    entryId,
    outActorId: ben.actorId,
    inActorId: cara.actorId,
  };

  test('reseats the Room of each live fixture and answers its change, with no draw version', () => {
    const decision = decideEntry(
      facts({
        people: [cara],
        entry: entry({ status: 'accepted', liveFixtures: [live('open')] }),
      }),
      replace,
    );
    assert({
      given: 'a member replaced while the fixture Round has not started',
      should:
        'change the members, reseat the Room, bump the slot and answer one officiated change',
      actual:
        decision.kind === 'accepted'
          ? {
              writes: decision.writes.map((w) => `${w.table}.${w.op}`),
              changes: decision.fixtureChanges,
            }
          : decision,
      expected: {
        writes: [
          'entry_members.delete',
          'entry_members.insert',
          'room_participants.update',
          'time_slots.update',
          'events.update',
        ],
        changes: [
          {
            kind: 'officiated',
            fixtureId: id('fixture'),
            tabRoundId: id('round'),
            commandId: id('command'),
            type: 'replace-entry-member',
            people: [ada.actorId, cara.actorId, id('judge')].sort(),
          },
        ],
      },
    });
  });

  test('each rule refuses by name', () => {
    const accepted = entry({ status: 'accepted' });
    assert({
      given: 'a replacement breaking one rule at a time',
      should: 'name the refusal',
      actual: [
        decideEntry(
          facts({
            people: [cara],
            entry: entry({ liveFixtures: [live('round_live')] }),
          }),
          replace,
        ),
        decideEntry(
          facts({
            people: [{ ...cara, enteredInEvent: true }],
            entry: accepted,
          }),
          replace,
        ),
        decideEntry(
          facts({
            people: [{ ...cara, enteredInSharedSlot: true }],
            entry: accepted,
          }),
          replace,
        ),
        decideEntry(
          facts({
            people: [{ ...cara, divisions: ['Open'] }],
            entry: accepted,
          }),
          replace,
        ),
        decideEntry(facts({ people: [], entry: accepted }), replace),
      ].map(refusalOf),
      expected: [
        'fixture-started',
        'already-entered',
        'slot-clash',
        'division-ineligible',
        'not-found',
      ],
    });
  });
});

describe('set-entry-division and choose-break', () => {
  test('a division is set from the event divisions', () => {
    assert({
      given:
        'a known division, an unknown one, one a member may not enter, and a started event',
      should: 'set the first and name the others',
      actual: [
        writesOf(
          decideEntry(facts(), {
            type: 'set-entry-division',
            entryId,
            division: 'Open',
          }),
        )[0],
        refusalOf(
          decideEntry(facts(), {
            type: 'set-entry-division',
            entryId,
            division: 'JV',
          }),
        ),
        refusalOf(
          decideEntry(
            facts({
              entry: entry({ members: [{ ...ada, divisions: ['Novice'] }] }),
            }),
            {
              type: 'set-entry-division',
              entryId,
              division: 'Open',
            },
          ),
        ),
        refusalOf(
          decideEntry(facts({ event: { ...facts().event, started: true } }), {
            type: 'set-entry-division',
            entryId,
            division: null,
          }),
        ),
      ],
      expected: [
        {
          table: 'entries',
          op: 'update',
          where: { id: entryId },
          set: { division: 'Open' },
        },
        'division-unknown',
        'division-ineligible',
        'stage-started',
      ],
    });
  });

  test('a double qualifier chooses one break while the choice is open', () => {
    const qualified = [
      { stageId: id('novicebreak'), division: 'Novice' },
      { stageId: id('openbreak'), division: 'Open' },
    ];
    const choose: EntryCommand = {
      type: 'choose-break',
      entryId,
      stageId: id('openbreak'),
    };
    assert({
      given: 'an entry in two breaks, one in one break, and a closed choice',
      should: 'record the break division, or name the refusal',
      actual: [
        writesOf(
          decideEntry(
            facts({ entry: entry({ breakChoice: { open: true, qualified } }) }),
            choose,
          ),
        )[0],
        refusalOf(
          decideEntry(
            facts({
              entry: entry({
                breakChoice: { open: true, qualified: qualified.slice(1) },
              }),
            }),
            choose,
          ),
        ),
        refusalOf(
          decideEntry(
            facts({
              entry: entry({ breakChoice: { open: false, qualified } }),
            }),
            choose,
          ),
        ),
      ],
      expected: [
        {
          table: 'entries',
          op: 'update',
          where: { id: entryId },
          set: { breakDivision: 'Open' },
        },
        'not-double-qualified',
        'choice-closed',
      ],
    });
  });
});
