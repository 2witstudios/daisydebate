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
      should: 'be sample actions worded by the resource’s own call to action',
      actual: [resourceAction(resource(false)), resourceAction(resource(true))],
      expected: [
        { kind: 'sample', label: resource(false).cta },
        { kind: 'sample', label: resource(true).cta },
      ],
    });
  });
});
