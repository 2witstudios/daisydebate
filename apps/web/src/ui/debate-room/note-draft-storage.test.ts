import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createNoteStorage,
  pruneExpiredNoteDrafts,
} from './note-draft-storage';
import { newNoteCopy } from './note-draft';
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
test('over the browser bound a shrinking write proceeds and anything larger is refused', () => {
  const f = fixture(),
    previous = f.adapter.read('d0', 100),
    before = [...f.storage.dump()];
  const grown = f.adapter.write(
    'd0',
    previous,
    {
      active: { ...f.active, html: '<p>A much longer private note</p>' },
      recovery: f.recovery,
    },
    100,
  );
  const inserted = f.adapter.write(
    'new',
    { record: {}, raw: null },
    { active: f.active },
    100,
  );
  const unchanged = [...f.storage.dump()];
  const shrunk = f.adapter.write('d0', previous, { active: f.active }, 100);
  assert({
    given: '17 preexisting records',
    should:
      'refuse growth and insertion without mutating anything, and allow removal',
    actual: [grown.stored, inserted.stored, unchanged, shrunk.stored],
    expected: [false, false, before, true],
  });
});

test('another record the write cannot decode is never deleted by that write', () => {
  const storage = memoryStorage();
  const adapter = createNoteStorage({
    storage,
    roundId: 'r',
    principalId: 'p',
    failed: () => {},
  });
  storage.setItem('daisy:round-notes:draft:p:r:other', '{malformed');
  const later = newNoteCopy({
    generation: 'later',
    html: '<p>later</p>',
    baseRevision: 1,
    now: 500,
  });
  storage.setItem(
    'daisy:round-notes:draft:p:r:clock',
    JSON.stringify({ active: later }),
  );
  const written = adapter.write(
    'd',
    { record: {}, raw: null },
    {
      active: newNoteCopy({
        generation: 'g',
        html: '<p>x</p>',
        baseRevision: 1,
        now: 100,
      }),
    },
    100,
  );
  assert({
    given: 'a malformed record and a copy saved later than this clock',
    should: 'write its own record and leave both of those untouched',
    actual: [
      written.stored,
      storage.getItem('daisy:round-notes:draft:p:r:other'),
      storage.getItem('daisy:round-notes:draft:p:r:clock') !== null,
    ],
    expected: [true, '{malformed', true],
  });
});

test('a corrupt record is discarded without reporting a storage problem', () => {
  const storage = memoryStorage(),
    warnings: string[] = [];
  const adapter = createNoteStorage({
    storage,
    roundId: 'r',
    principalId: 'p',
    failed: (id) => warnings.push(id),
  });
  storage.setItem('daisy:round-notes:draft:p:r:d', '{malformed');
  const read = adapter.read('d', 100);
  assert({
    given: 'a malformed record that can be removed',
    should: 'discard it and report nothing',
    actual: [read.raw, storage.dump().size, warnings],
    expected: [null, 0, []],
  });
});

test('pruning removes expired copies for every principal and keeps live ones', () => {
  const storage = memoryStorage();
  const old = newNoteCopy({
    generation: 'old',
    html: '<p>old</p>',
    baseRevision: 1,
    now: 100,
  });
  const fresh = newNoteCopy({
    generation: 'fresh',
    html: '<p>fresh</p>',
    baseRevision: 1,
    now: old.expiresAt,
  });
  storage.setItem(
    'daisy:round-notes:draft:p:r:gone',
    JSON.stringify({ recovery: old }),
  );
  storage.setItem(
    'daisy:round-notes:draft:q:r:partial',
    JSON.stringify({ active: fresh, recovery: old }),
  );
  storage.setItem('theme', 'dark');
  pruneExpiredNoteDrafts(storage, old.expiresAt);
  assert({
    given: 'a page load after one copy passed its seven days',
    should: 'drop only expired copies, whichever Round or principal holds them',
    actual: [
      [...storage.dump().keys()],
      JSON.parse(storage.getItem('daisy:round-notes:draft:q:r:partial')!),
    ],
    expected: [
      ['daisy:round-notes:draft:q:r:partial', 'theme'],
      { active: fresh },
    ],
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
