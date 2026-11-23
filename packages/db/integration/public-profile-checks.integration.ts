import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('a user row holds no image (ADR 0143)', async () => {
  await withFixture(url, async (f) => {
    const userId = await f.user();
    assert({
      given: 'an image written to a user row, then the row cleared of one',
      should: 'refuse the image by users_image_unused and accept the clear',
      actual: [
        await rejectedBy(
          () =>
            f.sql`update users set image = 'https://example.test/a.png' where id = ${userId}`,
        ),
        await rejectedBy(
          () => f.sql`update users set image = null where id = ${userId}`,
        ),
      ],
      expected: ['users_image_unused', null],
    });
  });
});
