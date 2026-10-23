import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { launchBrowserDockerArgs } from '../e2e/support/launch-browser-container';

setupRitewayBun();

const input = {
  name: 'daisy-browser-x',
  version: '1.63.0',
  checkout: '/repo',
  ca: '/tmp/ca.crt',
  seccomp: '/repo/seccomp.json',
  ports: [13012, 13013],
};
const valueAfter = (args: readonly string[], flag: string) =>
  args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []));

describe('isolated Launch browser container', () => {
  test('Docker Desktop forwards the listed host ports through host.docker.internal', () => {
    const args = launchBrowserDockerArgs({ ...input, hostNetwork: false });
    assert({
      given: 'a forwarded (macOS Docker Desktop) container',
      should:
        'publish only its loopback browser port and forward exactly the listed ports',
      actual: {
        network: args.includes('--network'),
        published: valueAfter(args, '-p'),
        env: valueAfter(args, '-e'),
      },
      expected: {
        network: false,
        published: ['127.0.0.1::3400'],
        env: [
          'DAISY_BROWSER_NETWORK=forwarded',
          'DAISY_BROWSER_FORWARD_PORTS=[13012,13013]',
          'NODE_EXTRA_CA_CERTS=/fixture/ca.crt',
        ],
      },
    });
  });

  test('Linux shares the host loopback, where host.docker.internal cannot reach loopback services', () => {
    const args = launchBrowserDockerArgs({ ...input, hostNetwork: true });
    assert({
      given: 'a Linux container',
      should:
        'join the host network with no published port and no forwarders to collide with the real services',
      actual: {
        network: valueAfter(args, '--network'),
        published: valueAfter(args, '-p'),
        env: valueAfter(args, '-e'),
        image: args.includes('mcr.microsoft.com/playwright:v1.63.0-noble'),
      },
      expected: {
        network: ['host'],
        published: [],
        env: [
          'DAISY_BROWSER_NETWORK=host',
          'DAISY_BROWSER_FORWARD_PORTS=[]',
          'NODE_EXTRA_CA_CERTS=/fixture/ca.crt',
        ],
        image: true,
      },
    });
  });
});
