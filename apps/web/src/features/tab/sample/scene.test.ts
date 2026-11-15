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
        'a saved scene, no cookie, an unknown viewer, an unknown moment, no scale and an unknown scale',
      should:
        'read the saved scene, fall back to the default for an unknown viewer or moment, and to the normal size for a scale',
      actual: [
        parseSampleScene(
          serializeSampleScene({
            viewer: 'host',
            moment: 'elims',
            scale: 'normal',
          }),
        ),
        parseSampleScene(undefined),
        parseSampleScene('admin.prelims'),
        parseSampleScene('host.tomorrow'),
        parseSampleScene('host.elims'),
        parseSampleScene('host.elims.huge'),
      ],
      expected: [
        { viewer: 'host', moment: 'elims', scale: 'normal' },
        defaultSampleScene,
        defaultSampleScene,
        defaultSampleScene,
        { viewer: 'host', moment: 'elims', scale: 'normal' },
        { viewer: 'host', moment: 'elims', scale: 'normal' },
      ],
    });
  });

  test('only the host holds a grant', () => {
    assert({
      given: 'the default scene and the host',
      should: 'give the host area to the host alone',
      actual: [
        holdsGrant(defaultSampleScene),
        holdsGrant({ viewer: 'host', moment: 'before', scale: 'normal' }),
      ],
      expected: [false, true],
    });
  });
});
