import { assert, setupRitewayBun, test } from 'riteway/bun';
import { returnPath } from './drive-return';
setupRitewayBun();
test('drive forms return only to existing drive openings', () => {
  const id = 'a'.repeat(24);
  assert({
    given: 'a retired folder path, Prep, a Round and its room',
    should: 'send the retired path to Prep and preserve existing openings',
    actual: [
      `/prep/folders/${id}`,
      '/prep',
      `/rounds/${id}`,
      `/rounds/${id}/room`,
    ].map(returnPath),
    expected: ['/prep', '/prep', `/rounds/${id}`, `/rounds/${id}/room`],
  });
});
