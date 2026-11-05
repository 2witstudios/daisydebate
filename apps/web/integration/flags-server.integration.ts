import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isReleaseEnabled } from '../src/features/flags/server';
import { adoptProcessApp } from '../src/server/process-app';
import { createTestApp } from './fixtures';

setupRitewayBun();
const { app } = createTestApp();
adoptProcessApp(app);

test('the public server display contract reads the adopted process database with a nullable subject', async () => {
  assert({
    given: 'the real server entry with no stored release state or account',
    should: 'return only the closed presentation boolean',
    actual: await isReleaseEnabled('premium-checkout', null),
    expected: false,
  });
});
