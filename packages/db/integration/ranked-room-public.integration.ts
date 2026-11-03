import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the database holds a ranked Room to public', async () => {
  await withFixture(databaseUrl, async (f) => {
    const actor = await f.actor();
    const format = await f.format();
    await f.preset(format);
    const ranked = (visibility: string) =>
      f.room(actor, format, {
        competition_type: 'ranked',
        preset_version: 1,
        visibility,
      });
    const refusal = async (visibility: string) =>
      ranked(visibility).then(
        () => 'accepted',
        (error: { constraint?: string; message: string }) =>
          error.constraint ?? error.message,
      );
    const casual = await f.room(actor, format, { visibility: 'unlisted' });
    assert({
      given: 'ranked Rooms written unlisted, private and public',
      should: 'refuse the first two by constraint and accept public',
      actual: [
        await refusal('unlisted'),
        await refusal('private'),
        await refusal('public'),
      ],
      expected: [
        'rooms_ranked_public_check',
        'rooms_ranked_public_check',
        'accepted',
      ],
    });
    assert({
      given: 'a casual Room written unlisted',
      should: 'leave casual visibility free',
      actual: typeof casual,
      expected: 'string',
    });
  });
});
