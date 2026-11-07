import { assert, setupRitewayBun, test } from 'riteway/bun';
import { acceptShellNavigation } from './shell-navigation';
setupRitewayBun();

test('installed App Router Link cancellation and explicit answer dispatch keep their actual semantics', async () => {
  const child = Bun.spawn(
    [
      'bun',
      `${import.meta.dir}/../../../../scripts/shell-navigation-realm.test-support.ts`,
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10000,
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Mounted shell failed: ${stderr}`);
  assert({
    given:
      'actual installed Next onNavigate cancellation and a new callback identity for the same answer',
    should:
      'prevent Next navigation, announce nothing cancelled and follow the answered destination once',
    actual: JSON.parse(stdout),
    expected: {
      cancelled: 1,
      prevented: true,
      notices: 0,
      calls: ['before-one', 'replace:/messages/newer'],
    },
  });
}, 15000);

test('the shell announces only a navigation its caller accepted', () => {
  const calls: string[] = [];
  const event = {
    preventDefault: () => {
      calls.push('prevented');
    },
  };
  const notify = () => {
    calls.push('accepted');
  };
  acceptShellNavigation(event, undefined, notify);
  acceptShellNavigation(
    event,
    (choice) => {
      choice.preventDefault();
    },
    notify,
  );
  acceptShellNavigation(
    event,
    () => {
      calls.push('caller');
    },
    notify,
  );
  assert({
    given:
      'an ordinary choice, a cancelled choice and an accepted caller callback',
    should: 'announce only after acceptance, preserving cancellation semantics',
    actual: calls,
    expected: ['accepted', 'prevented', 'caller', 'accepted'],
  });
});
