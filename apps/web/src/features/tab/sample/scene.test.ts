import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultSampleScene,
  holdsGrant,
  parseSampleScene,
  serializeSampleScene,
} from './scene';

setupRitewayBun();

describe('parseSampleScene', () => {
  test('the cookie is untrusted', () => {
    assert({
      given:
        'a saved scene, no cookie, an unknown viewer and an unknown moment',
      should: 'read the saved scene and fall back to the default for the rest',
      actual: [
        parseSampleScene(
          serializeSampleScene({ viewer: 'host', moment: 'elims' }),
        ),
        parseSampleScene(undefined),
        parseSampleScene('admin.prelims'),
        parseSampleScene('host.tomorrow'),
      ],
      expected: [
        { viewer: 'host', moment: 'elims' },
        defaultSampleScene,
        defaultSampleScene,
        defaultSampleScene,
      ],
    });
  });

  test('only the host holds a grant', () => {
    assert({
      given: 'the default scene and the host',
      should: 'give the host area to the host alone',
      actual: [
        holdsGrant(defaultSampleScene),
        holdsGrant({ viewer: 'host', moment: 'before' }),
      ],
      expected: [false, true],
    });
  });
});
