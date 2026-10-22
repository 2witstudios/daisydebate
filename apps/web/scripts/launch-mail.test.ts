import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLaunchMail, launchMailFetch } from '../e2e/support/launch-mail';
setupRitewayBun();

test('rolling web processes share actual captured mail through one private Unix transport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daisy-mail-proof-'));
  const path = join(directory, 'mail.sock');
  const mail = createLaunchMail({
    path,
    port: 0,
    redisUrl: 'redis://127.0.0.1:1/2',
    redisNamespace: 'unused',
  });
  try {
    await mail.started;
    const send = launchMailFetch(path);
    const answers = await Promise.all(
      ['first', 'second'].map((text) =>
        send('https://api.resend.com/emails', {
          method: 'POST',
          body: JSON.stringify({
            to: ['proof@example.test'],
            subject: 'Confirm',
            text,
            html: '<p>Confirm</p>',
          }),
        }),
      ),
    );
    assert({
      given:
        'two actual Unix transport requests to the same owned mail capture',
      should:
        'retain both messages across application process lifetimes with owner-only access',
      actual: [
        answers.map((answer) => answer.status),
        mail.mails.map((item) => item.text).sort(),
        (await stat(path)).mode & 0o777,
      ],
      expected: [[200, 200], ['first', 'second'], 0o600],
    });
  } finally {
    await mail.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
