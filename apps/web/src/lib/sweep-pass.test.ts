import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createSweepPass } from './sweep-pass';

setupRitewayBun();

const pagesOf =
  (ids: readonly string[], size: number) => async (after: string | null) =>
    ids.filter((id) => after === null || id > after).slice(0, size);
const self = (id: string) => id;

describe('createSweepPass', () => {
  test('reaches every row past the first page', async () => {
    const seen: string[] = [];
    await createSweepPass().overPages(
      2,
      pagesOf(['a', 'b', 'c', 'd', 'e'], 2),
      self,
      async (id) => seen.push(id),
      () => {},
    );
    assert({
      given: 'five rows at two a page',
      should: 'work on all five in one pass',
      actual: seen,
      expected: ['a', 'b', 'c', 'd', 'e'],
    });
  });
  test('a slow row delays no other, and is not run twice', async () => {
    const seen: string[] = [];
    let release = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pass = createSweepPass(async () => {});
    const once = () =>
      pass.overPages(
        8,
        pagesOf(['slow', 'zippy'], 8),
        self,
        async (id) => {
          seen.push(id);
          if (id === 'slow') await slow;
        },
        () => {},
      );
    await once();
    await once();
    const settling = pass.settled();
    release();
    await settling;
    assert({
      given: 'a row that outlasts the budget of two passes',
      should: 'run the other in each pass and the slow one once',
      actual: seen,
      expected: ['slow', 'zippy', 'zippy'],
    });
  });
  test('a failure reaches only its row', async () => {
    const seen: string[] = [];
    let failures = 0;
    await createSweepPass().overPages(
      8,
      pagesOf(['bad', 'good'], 8),
      self,
      async (id) => {
        if (id === 'bad') throw new Error('down');
        seen.push(id);
      },
      () => {
        failures += 1;
      },
    );
    assert({
      given: 'one row failing',
      should: 'report it and finish the other',
      actual: [seen, failures],
      expected: [['good'], 1],
    });
  });
});
