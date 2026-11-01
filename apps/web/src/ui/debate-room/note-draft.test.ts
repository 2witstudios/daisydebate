import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  acknowledgeNoteRecord,
  decodeNoteRecord,
  discardNoteRecord,
  editNoteRecord,
  encodeNoteRecord,
  expireNoteRecord,
  newNoteCopy,
  offerNoteRecord,
  restoreNoteRecord,
  type NoteRecord,
} from './note-draft';
setupRitewayBun();
const copy = (generation: string, html: string, now = 100) =>
  newNoteCopy({ generation, html, baseRevision: 3, now });
const frozen = (record: NoteRecord): NoteRecord => Object.freeze(record);

test('typing and acknowledgements preserve an independent recovery identity and retention', () => {
  const recovery = Object.freeze(copy('REC', '<p>recovery</p>'));
  const active = Object.freeze(copy('NEW', '<p>new</p>', 200));
  const original = frozen({ recovery });
  const edited = editNoteRecord(original, active, false);
  const acked = acknowledgeNoteRecord(edited.record, {
    generation: 'NEW',
    revision: 4,
    rebaseGeneration: null,
  });
  assert({
    given: 'REC followed by NEW typing and acknowledgement',
    should: 'clear only the acknowledged active copy, preserving REC unchanged',
    actual: [acked.record, original, recovery.savedAt, recovery.expiresAt],
    expected: [{ recovery }, { recovery }, 100, 604800100],
  });
});

test('an older acknowledgement rebases only the named current active copy', () => {
  const active = copy('B', '<p>B</p>', 200),
    recovery = copy('REC', '<p>REC</p>');
  const result = acknowledgeNoteRecord(frozen({ active, recovery }), {
    generation: 'A',
    revision: 4,
    rebaseGeneration: 'B',
  });
  assert({
    given: 'A acknowledges with B pending and REC independent',
    should: 'rebase B without changing either copy identity or retention',
    actual: result.record,
    expected: { active: { ...active, baseRevision: 4 }, recovery },
  });
});

test('Restore swaps different unsaved active text into recovery with original retention', () => {
  const active = copy('NEW', '<p>new</p>', 200),
    recovery = copy('REC', '<p>recovery</p>');
  const record = frozen({ active, recovery });
  const result = restoreNoteRecord(record, {
    generation: 'REC',
    active,
    activeOffered: false,
    newGeneration: 'RESTORED',
    revision: 4,
  });
  assert({
    given: 'REC selected while NEW is still unsaved',
    should: 'make REC an ordinary CAS edit and retain NEW in the recovery slot',
    actual: result,
    expected: {
      status: 'changed',
      record: {
        active: { ...recovery, generation: 'RESTORED', baseRevision: 4 },
        recovery: active,
      },
    },
  });
});

test('a recovery offer survives serialization and reload after NEW acknowledgement', () => {
  const recovery = copy('REC', '<p>recovery</p>');
  const active = copy('NEW', '<p>new</p>', 200);
  const acked = acknowledgeNoteRecord(
    { active, recovery },
    { generation: 'NEW', revision: 4, rebaseGeneration: null },
  );
  const encoded = encodeNoteRecord(acked.record)!;
  const loaded = decodeNoteRecord(encoded.raw, { now: 300, serverRevision: 4 });
  assert({
    given: 'NEW acknowledged before the browser reloads',
    should: 'still load the independent REC for explicit Restore',
    actual: loaded,
    expected: { ok: true, record: { recovery }, expired: false },
  });
});

test('stale choices and an occupied third-copy transition leave the input unchanged', () => {
  const active = copy('A', '<p>A</p>'),
    recovery = copy('REC', '<p>REC</p>');
  const record = frozen({ active, recovery });
  const stale = restoreNoteRecord(record, {
    generation: 'OLD',
    active,
    activeOffered: false,
    newGeneration: 'unused',
    revision: 4,
  });
  const discarded = discardNoteRecord(record, 'OLD');
  const occupied = editNoteRecord(record, copy('NEW', '<p>NEW</p>'), true);
  assert({
    given: 'a stale offer action or a third copy beyond the two named slots',
    should: 'refuse without mutating or silently discarding either stored copy',
    actual: [
      stale.status,
      stale.record === record,
      discarded.status,
      discarded.record === record,
      occupied.status,
      occupied.record === record,
    ],
    expected: ['stale', true, 'stale', true, 'occupied', true],
  });
});

test('combined serialized overflow preserves the durable recovery instead of extending or evicting it', () => {
  const recovery = copy('REC', `<p>${'r'.repeat(150_000)}</p>`);
  const record = frozen({ recovery });
  const result = editNoteRecord(
    record,
    copy('NEW', `<p>${'n'.repeat(150_000)}</p>`),
    false,
  );
  assert({
    given: 'two copies together exceed 256 KiB including record overhead',
    should:
      'refuse the durable transition with the original recovery unchanged',
    actual: [
      result.status,
      result.record === record,
      encodeNoteRecord(result.record) !== null,
    ],
    expected: ['overflow', true, true],
  });
});

test('each slot expires independently and a paused active copy is offered without renewing it', () => {
  const active = copy('A', '<p>A</p>'),
    recovery = copy('REC', '<p>REC</p>', 200);
  const expired = expireNoteRecord({ active, recovery }, active.expiresAt);
  const offered = offerNoteRecord({ active });
  assert({
    given:
      'active expires before recovery and another record contains a paused edit',
    should:
      'expire only the old copy and preserve the offered identity and timestamps',
    actual: [expired, offered],
    expected: [{ recovery }, { recovery: active }],
  });
});

test('the pre-ship record validator rejects the old shape and malformed or future copies', () => {
  const valid = copy('A', '<p>A</p>');
  const invalid = [
    valid,
    { active: { ...valid, generation: 1 } },
    { recovery: { ...valid, baseRevision: 999 } },
    { active: valid, extra: true },
  ];
  assert({
    given:
      'legacy single-copy data, malformed identities, future revisions and unknown slots',
    should: 'fail closed without a compatibility mode',
    actual: invalid.map(
      (record) =>
        decodeNoteRecord(JSON.stringify(record), {
          now: 200,
          serverRevision: 3,
        }).ok,
    ),
    expected: [false, false, false, false],
  });
});
