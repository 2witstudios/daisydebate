import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderShareImage } from './share-image';
import Icon from '../app/icon';
import AppleIcon from '../app/apple-icon';

setupRitewayBun();

test('ImageResponse rasterizes all share formats and both icon sizes', async () => {
  for (const [name, response, expected] of [
    ['favicon', Icon(), [32, 32]],
    ['apple', AppleIcon(), [180, 180]],
    ['og', await renderShareImage('og'), [1200, 630]],
    ['x', await renderShareImage('x'), [1600, 900]],
    ['square', await renderShareImage('square', 'dark'), [1080, 1080]],
    ['story', await renderShareImage('story'), [1080, 1920]],
    ['youtube', await renderShareImage('youtube'), [1280, 720]],
  ] as const) {
    const bytes = Buffer.from(await response.arrayBuffer());
    assert({
      given: `${name} rendered through the real local fonts and Satori`,
      should: 'produce PNG bytes with the requested dimensions',
      actual: [
        bytes.subarray(1, 4).toString(),
        bytes.readUInt32BE(16),
        bytes.readUInt32BE(20),
      ],
      expected: ['PNG', ...expected],
    });
  }
});
