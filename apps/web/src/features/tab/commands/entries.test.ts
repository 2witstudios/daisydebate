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
  boundary: null,
  ...overrides,
});
const ada = person('ada');
const ben = person('ben');
/** A minor whose parent allows only another lobby. */
const minor = person('min', {
  minor: true,
  boundary: {
    guardianLinkId: id('link'),
    guardianUserId: parent,
    allowedLobbyIds: [id('otherlobby')],
    version: 4,
  },
});

const entry = (overrides: Partial<EntryRowFacts> = {}): EntryRowFacts => ({
  id: entryId,
  status: 'pending',
  division: 'Novice',
  responsibleKind: 'school',
  guardianUserId: null,
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

describe('a minor outside the guardian allowed lobbies (TAB-5.23)', () => {
  const coachEntersMinor = submit({
    memberActorIds: [minor.actorId, ada.actorId],
  });
  const pendingEntry = entry({ members: [minor, ada] });

  test('an entry a coach makes stays pending even when the host sends it', () => {
    const decision = decideEntry(
      facts({
        sender: { userId: coach, host: true },
        event: { ...facts().event, approval: 'automatic' },
      }),
      coachEntersMinor,
    );
    const write = insertedEntry(decision);
    assert({
      given: 'a coach entering a minor whose parent does not allow this lobby',
      should: 'insert the entry pending',
      actual:
        write?.op === 'insert' && write.table === 'entries'
          ? write.row.status
          : null,
      expected: 'pending',
    });
  });

  test('it cannot be accepted until the guardian allows the lobby', () => {
    const allowed = {
      ...minor,
      boundary: {
        ...minor.boundary!,
        allowedLobbyIds: [id('otherlobby'), lobbyId],
      },
    };
    const accepting = decideEntry(
      facts({ entry: entry({ members: [allowed, ada] }) }),
      { type: 'accept-entry', entryId },
    );
    assert({
      given: 'accepting it before and after the parent allows the lobby',
      should:
        'refuse guardian-pending, then accept and bump the boundary revision',
      actual: {
        before: refusalOf(
          decideEntry(facts({ entry: pendingEntry }), {
            type: 'accept-entry',
            entryId,
          }),
        ),
        after: writesOf(accepting).filter((write) => write.table !== 'events'),
      },
      expected: {
        before: 'guardian-pending',
        after: [
          {
            table: 'entries',
            op: 'update',
            where: { id: entryId },
            set: { status: 'accepted' },
          },
          {
            table: 'restrictions',
            op: 'update',
            where: { guardianLinkId: id('link') },
            set: { version: 5 },
          },
        ],
      },
    });
  });

  test('the guardian own entry is not awaited', () => {
    assert({
      given: "an entry whose responsible adult is the minor's parent",
      should: 'be acceptable',
      actual: refusalOf(
        decideEntry(
          facts({
            entry: entry({
              members: [minor],
              responsibleKind: 'guardian',
              guardianUserId: parent,
            }),
          }),
          { type: 'accept-entry', entryId },
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
