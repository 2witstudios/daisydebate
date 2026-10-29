import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertPrivateIngressLogs } from './admin-ingress-log-check';
setupRitewayBun();
test('private ingress log streams', () => {
  const fixture = 'https://login.tailscale.invalid/a/fixture';
  const result = (stdout: string, stderr: string) => {
    try {
      assertPrivateIngressLogs({ stdout, stderr });
      return 'clean';
    } catch (error) {
      return (error as Error).message;
    }
  };
  assert({
    given: 'an authentication URL on stdout or stderr',
    should: 'refuse without echoing the URL',
    actual: [
      result(fixture, ''),
      result('', fixture),
      result('ready', 'diagnostic'),
    ],
    expected: [
      'Ingress logged an authentication URL',
      'Ingress logged an authentication URL',
      'clean',
    ],
  });
});
