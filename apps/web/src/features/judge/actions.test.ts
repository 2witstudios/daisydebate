import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resourceAction } from './actions';
import type { JudgeResource } from './resources';

setupRitewayBun();

const resource = (neededToQualify: boolean): JudgeResource => ({
  kind: neededToQualify ? 'practice' : 'guide',
  title: 'T',
  blurb: '',
  meta: '',
  cta: '',
  neededToQualify,
  onHub: false,
});

describe('resourceAction', () => {
  test('a guide and the practice debates', () => {
    assert({
      given: 'a guide and the practice resource',
      should: 'be inert with a reason that names what is missing',
      actual: [resourceAction(resource(false)), resourceAction(resource(true))],
      expected: [
        { kind: 'inert', reason: 'This guide is not written yet.' },
        { kind: 'inert', reason: 'Practice debates are not recorded yet.' },
      ],
    });
  });
});
