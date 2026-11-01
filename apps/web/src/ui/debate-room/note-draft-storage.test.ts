import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createNoteStorage } from './note-draft-storage';
import {
  newNoteCopy,
  removesOnlyNoteCopies,
  type NoteCopy,
  type NoteRecord,
} from './note-draft';
import { memoryStorage } from './document-sync.test-support';
setupRitewayBun();
const fixture = () => {
  const storage = memoryStorage(),
    warnings: string[] = [];
  const key = 'daisy:round-notes:draft:p:r:d0';
  const active = newNoteCopy({
    generation: 'active',
    html: '<p>A</p>',
    baseRevision: 3,
    now: 100,
  });
  const recovery = newNoteCopy({
    generation: 'REC',
    html: '<p>REC</p>',
    baseRevision: 3,
    now: 100,
  });
  for (let i = 0; i < 17; i++)
    storage.setItem(
      `daisy:round-notes:draft:p:r:d${i}`,
      JSON.stringify(
        i === 0
          ? { active, recovery }
          : { recovery: { ...recovery, generation: `r${i}` } },
      ),
    );
  const adapter = createNoteStorage({
    storage,
    roundId: 'r',
    principalId: 'p',
    failed: (id) => {
      warnings.push(id);
    },
  });
  return { storage, adapter, key, active, recovery, warnings };
};
const changes: readonly [string, Partial<NoteCopy>][] = [
  ['generation', { generation: 'other' }],
  ['content', { html: '<p>B</p>' }],
  ['base', { baseRevision: 4 }],
  ['renewal', { savedAt: 101, expiresAt: 604800101 }],
  ['saved timestamp', { savedAt: 101 }],
  ['expiry', { expiresAt: 604800101 }],
];
for (const [name, mutation] of changes)
  test(`overfull cleanup refuses a survivor ${name} mutation`, () => {
    const f = fixture(),
      previous = f.adapter.read('d0', 100),
      before = [...f.storage.dump()];
    const result = f.adapter.write(
      'd0',
      previous,
      { active: { ...f.active, ...mutation } },
      100,
    );
    assert({
      given: 'removal mixed with a changed surviving copy',
      should: 'refuse without mutating the target or unrelated records',
      actual: [result.stored, [...f.storage.dump()], f.warnings.length > 0],
      expected: [false, before, true],
    });
  });

test('overfull state refuses unchanged/replaced records and insertion of a new record', () => {
  const f = fixture(),
    previous = f.adapter.read('d0', 100),
    before = [...f.storage.dump()];
  const unchanged = f.adapter.write('d0', previous, previous.record, 100);
  const replaced = f.adapter.write(
    'd0',
    previous,
    { active: { ...f.active, generation: 'new' }, recovery: f.recovery },
    100,
  );
  const inserted = f.adapter.write(
    'new',
    { record: {}, raw: null },
    { active: f.active },
    100,
  );
  assert({
    given: '17 preexisting records',
    should: 'admit no insertion, replacement or non-shrinking write',
    actual: [
      unchanged.stored,
      replaced.stored,
      inserted.stored,
      [...f.storage.dump()],
    ],
    expected: [false, false, false, before],
  });
});

test('strict copy removal also requires non-increasing serialized bytes', () => {
  const f = fixture(),
    before: NoteRecord = { active: f.active, recovery: f.recovery },
    after = { active: f.active };
  assert({
    given: 'the exact same survivor but a larger serialized candidate',
    should: 'refuse the cleanup exception',
    actual: [
      removesOnlyNoteCopies(before, after, 100, 101),
      removesOnlyNoteCopies(before, after, 100, 100),
    ],
    expected: [false, true],
  });
});

test('a stale snapshot cannot remove a newer durable offer', () => {
  const f = fixture(),
    previous = f.adapter.read('d0', 100);
  const newer = JSON.stringify({
    active: f.active,
    recovery: { ...f.recovery, generation: 'newer' },
  });
  f.storage.setItem(f.key, newer);
  const result = f.adapter.write('d0', previous, { active: f.active }, 100);
  assert({
    given: 'durable state changed after the choice was read',
    should: 'refuse and reread without consuming the newer offer',
    actual: [
      result.stored,
      f.storage.getItem(f.key),
      result.snapshot.record.recovery?.generation,
    ],
    expected: [false, newer, 'newer'],
  });
});

test('a forged snapshot cannot make malformed durable data eligible for the removal exception', () => {
  const f = fixture();
  f.storage.setItem(f.key, '{malformed');
  const result = f.adapter.write(
    'd0',
    { raw: '{malformed', record: { active: f.active, recovery: f.recovery } },
    { active: f.active },
    100,
  );
  assert({
    given: 'a supplied record that disagrees with malformed actual storage',
    should: 'validate the fresh raw value and refuse the exception',
    actual: [result.stored, f.storage.getItem(f.key), f.warnings.length > 0],
    expected: [false, '{malformed', true],
  });
});
