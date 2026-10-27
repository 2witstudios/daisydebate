import { getTableColumns, getTableName } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rooms, roomParticipants } from '../schema/rooms';
import { rounds } from '../schema/rounds';
import { roundParticipants } from '../schema/round-participants';
import { validatePrivacyAdoption } from './declarations';
import { roomPrivacyFields } from './room-declarations';

setupRitewayBun();

test('Room and Round inventory covers the exact producer schema', () => {
  const expected = Object.fromEntries(
    [rooms, roomParticipants, rounds, roundParticipants].map((table) => [
      getTableName(table),
      Object.values(getTableColumns(table)).map((column) => column.name),
    ]),
  );
  assert({
    given: 'every current Room and Round column',
    should:
      'declare each exactly once without approving pending privacy policy',
    actual: validatePrivacyAdoption(expected, roomPrivacyFields),
    expected: { problems: [], activationHeld: true },
  });
  assert({
    given: 'a future producer column without an inventory entry',
    should: 'refuse adoption',
    actual: validatePrivacyAdoption(
      { ...expected, rooms: [...expected.rooms!, 'undeclared_text'] },
      roomPrivacyFields,
    ).problems,
    expected: ['Missing rooms.undeclared_text'],
  });
});

test('authored room text has explicit subject-rights declarations', () => {
  assert({
    given: 'host-authored titles, topics and frozen resolutions',
    should:
      'treat all free text as private, exportable and scrubbed on erasure',
    actual: roomPrivacyFields
      .filter((field) => field.category === 'personal')
      .map(({ table, column, visibility, erasure, exportable }) => [
        table,
        column,
        visibility,
        erasure,
        exportable,
      ]),
    expected: [
      ['rooms', 'title', 'private', 'scrub', true],
      ['rooms', 'topic', 'private', 'scrub', true],
      ['rounds', 'resolution', 'private', 'scrub', true],
    ],
  });
});

test('runtime checkpoint classifies its embedded participant reference', () => {
  assert({
    given: 'the floor holder participant id embedded in rounds.runtime_state',
    should: 'classify the checkpoint as an identifier surface',
    actual: roomPrivacyFields.find(
      (field) => field.table === 'rounds' && field.column === 'runtime_state',
    )?.category,
    expected: 'identifier',
  });
});
