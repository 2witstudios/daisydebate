import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hubResources, type JudgeResource } from './resources';

setupRitewayBun();

const resource = (
  kind: JudgeResource['kind'],
  onHub: boolean,
): JudgeResource => ({
  kind,
  title: kind,
  blurb: '',
  meta: '',
  cta: '',
  neededToQualify: false,
  onHub,
});

describe('hubResources', () => {
  test('the short list', () => {
    assert({
      given: 'resources of which two are flagged for the hub',
      should: 'keep only those two, in order',
      actual: hubResources([
        resource('guide', true),
        resource('criteria', false),
        resource('practice', true),
      ]).map(({ kind }) => kind),
      expected: ['guide', 'practice'],
    });
  });
});
