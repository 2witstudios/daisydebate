import { getTableColumns, getTableName } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rooms, roomParticipants } from '../schema/rooms';
import { rounds } from '../schema/rounds';
import { roundParticipants } from '../schema/round-participants';
import { validatePrivacyAdoption } from '@daisy/protocol/privacy';
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
    given:
      'host-authored titles, topics, frozen resolutions and the config and plan that carry a host’s draw lines',
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
      ['rooms', 'config', 'private', 'scrub', true],
      ['rooms', 'execution_plan', 'private', 'scrub', true],
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

test('the format catalog declares every column it stores (PR #472 review)', async () => {
  const { formats } = await import('../schema/formats');
  const { formatRevisions } = await import('../schema/format-revisions');
  const { formatPresets } = await import('../schema/format-presets');
  const { formatPrivacyFields } = await import('./format-declarations');
  const expected = Object.fromEntries(
    [formats, formatRevisions, formatPresets].map((table) => [
      getTableName(table),
      Object.values(getTableColumns(table)).map((column) => column.name),
    ]),
  );
  assert({
    given: 'the formats, format revisions and format presets schema',
    should: 'declare each column exactly once',
    actual: validatePrivacyAdoption(expected, formatPrivacyFields),
    expected: { problems: [], activationHeld: true },
  });
});
