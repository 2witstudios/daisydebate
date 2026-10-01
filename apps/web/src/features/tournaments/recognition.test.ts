import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recognitionFor } from './recognition';

setupRitewayBun();

describe('recognitionFor', () => {
  test('each structure recognizes its placings and every entrant', () => {
    assert({
      given: 'each structure',
      should: 'list its honours ending with the participation record',
      actual: [
        recognitionFor('single-elimination').map((r) => r.title),
        recognitionFor('round-robin').map((r) => r.title),
      ],
      expected: [
        ['Champion', 'Runner-up', 'Semifinalists', 'Every entrant'],
        ['Winner', 'Every entrant'],
      ],
    });
  });
});
