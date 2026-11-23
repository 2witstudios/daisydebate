import { assert, setupRitewayBun, test } from 'riteway/bun';
import { composeStores } from './resources';

setupRitewayBun();

test('composing stores keeps every operation and refuses a shared name', () => {
  const read = () => 'a';
  const write = () => 'b';
  assert({
    given: 'two stores with distinct operations',
    should: 'compose each operation under its own name',
    actual: Object.keys(composeStores({ read }, { write })),
    expected: ['read', 'write'],
  });
  let refusal: unknown;
  try {
    composeStores({ read }, { read: write });
  } catch (error) {
    refusal = error;
  }
  assert({
    given: 'a second store exposing a name the first already exposes',
    should: 'refuse the composition, naming the operation',
    actual: (refusal as Error | undefined)?.message,
    expected: 'Two composed stores both expose read',
  });
});
