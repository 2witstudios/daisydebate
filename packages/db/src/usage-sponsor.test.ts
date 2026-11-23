import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireAdmissionTarget } from './usage-sponsor';

setupRitewayBun();

const host = 'hostaaaaa1b2c3d4e5f6g7h8';
test('admission targets are cuid2 actor and Round ids', async () => {
  assert({
    given: 'cuid2 ids',
    should: 'admit the target',
    actual: requireAdmissionTarget({ actorId: host, roundId: host }),
    expected: undefined,
  });
  await assertRejects({
    given: 'a non-cuid2 Round id',
    should: 'refuse it as invalid input',
    actual: () => requireAdmissionTarget({ actorId: host, roundId: '1' }),
    code: 'VALIDATION',
  });
});
