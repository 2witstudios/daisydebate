import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  acknowledgeDraftRecord,
  decodeDraftRecord,
  discardDraftRecord,
  editDraftRecord,
  encodeDraftRecord,
  expireDraftRecord,
  newDraftCopy,
  offerDraftRecord,
  restoreDraftRecord,
  type DraftRecord,
} from './document-draft';
setupRitewayBun();
const copy = (generation: string, html: string, now = 100) =>
  newDraftCopy({ generation, html, baseRevision: 3, now });
const frozen = (record: DraftRecord): DraftRecord => Object.freeze(record);

test('typing and acknowledgements preserve an independent recovery identity and retention', () => {
  const recovery = Object.freeze(copy('REC', '<p>recovery</p>'));
  const active = Object.freeze(copy('NEW', '<p>new</p>', 200));
  const original = frozen({ recovery });
  const edited = editDraftRecord(original, active, false);
  const acked = acknowledgeDraftRecord(edited.record, {
    generation: 'NEW',
    revision: 4,
    rebaseGeneration: null,
    supersededByThisOwner: () => false,
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
  const result = acknowledgeDraftRecord(frozen({ active, recovery }), {
    generation: 'A',
    revision: 4,
    rebaseGeneration: 'B',
    supersededByThisOwner: () => false,
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
  const result = restoreDraftRecord(record, {
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
  const acked = acknowledgeDraftRecord(
    { active, recovery },
    {
      generation: 'NEW',
      revision: 4,
      rebaseGeneration: null,
      supersededByThisOwner: () => false,
    },
  );
  const encoded = encodeDraftRecord(acked.record)!;
  const loaded = decodeDraftRecord(encoded.raw, 300);
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
  const stale = restoreDraftRecord(record, {
    generation: 'OLD',
    active,
    activeOffered: false,
    newGeneration: 'unused',
    revision: 4,
  });
  const discarded = discardDraftRecord(record, 'OLD');
  const occupied = editDraftRecord(record, copy('NEW', '<p>NEW</p>'), true);
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
  const result = editDraftRecord(
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
      encodeDraftRecord(result.record) !== null,
    ],
    expected: ['overflow', true, true],
  });
});

test('each slot expires independently and a paused active copy is offered without renewing it', () => {
  const active = copy('A', '<p>A</p>'),
    recovery = copy('REC', '<p>REC</p>', 200);
  const expired = expireDraftRecord({ active, recovery }, active.expiresAt);
  const offered = offerDraftRecord({ active });
  assert({
    given:
      'active expires before recovery and another record contains a paused edit',
    should:
      'expire only the old copy and preserve the offered identity and timestamps',
    actual: [expired, offered],
    expected: [{ recovery }, { recovery: active }],
  });
});

test('the pre-ship record validator rejects the old shape and malformed copies', () => {
  const valid = copy('A', '<p>A</p>');
  const invalid = [
    valid,
    { active: { ...valid, generation: 1 } },
    { active: valid, extra: true },
  ];
  assert({
    given: 'legacy single-copy data, malformed identities and unknown slots',
    should: 'fail closed without a compatibility mode',
    actual: invalid.map(
      (record) => decodeDraftRecord(JSON.stringify(record), 200).ok,
    ),
    expected: [false, false, false],
  });
});

test('an acknowledgement clears every slot it proves saved', () => {
  const rec = copy('REC', '<p>REC</p>');
  const older = copy('older', '<p>older</p>');
  const moved = acknowledgeDraftRecord(
    { recovery: rec },
    {
      generation: 'REC',
      revision: 4,
      rebaseGeneration: null,
      supersededByThisOwner: () => false,
    },
  );
  const unstored = acknowledgeDraftRecord(
    { active: older },
    {
      generation: 'newest-not-stored',
      revision: 4,
      rebaseGeneration: null,
      supersededByThisOwner: (generation) => generation === 'older',
    },
  );
  const foreign = acknowledgeDraftRecord(
    { active: older },
    {
      generation: 'newest-not-stored',
      revision: 4,
      rebaseGeneration: null,
      supersededByThisOwner: (generation) => generation === 'mine',
    },
  );
  assert({
    given:
      'a copy moved to recovery by another tab, an older copy of mine, and a copy of another tab',
    should: 'drop the first two and leave the other tab its own copy',
    actual: [moved.record, unstored.record, foreign.status],
    expected: [{}, {}, 'unchanged'],
  });
});

test('a copy saved later than a stepped-back clock is kept', () => {
  const later = newDraftCopy({
    generation: 'later',
    html: '<p>later</p>',
    baseRevision: 3,
    now: 5000,
  });
  const decoded = decodeDraftRecord(JSON.stringify({ active: later }), 4000);
  assert({
    given: 'a wall clock now earlier than the copy savedAt',
    should: 'keep the copy, since only its expiry decides',
    actual: decoded.ok && decoded.record,
    expected: { active: later },
  });
});
