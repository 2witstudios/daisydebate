import { assert, setupRitewayBun, test } from 'riteway/bun';
import { floorEditSeed } from './edit-draft';
setupRitewayBun();
test('canonical edits update a clean editor while preserving dirty and uncertain drafts', () => {
  const answer = { text: 'Original text', requestId: 'r'.repeat(24) };
  assert({
    given: 'a newer canonical message while an edit form exists',
    should:
      'adopt it only when no local draft or unknown command owns the field',
    actual: [
      floorEditSeed(answer, 'Canonical edit', false),
      floorEditSeed(answer, 'Canonical edit', true),
      floorEditSeed({ ...answer, uncertain: true }, 'Canonical edit', false),
    ],
    expected: ['Canonical edit', 'Original text', 'Original text'],
  });
});
