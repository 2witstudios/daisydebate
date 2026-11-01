import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { launchBrowserDockerArgs } from '../e2e/support/launch-browser-container';

setupRitewayBun();

const input = {
  name: 'daisy-browser-x',
  image: `sha256:${'a'.repeat(64)}`,
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
        image: args.includes(input.image),
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

test('runtime performs only local fresh trust and sandbox startup', async () => {
  const shell = await Bun.file(
    new URL('../e2e/support/launch-browser-container.sh', import.meta.url),
  ).text();
  assert({
    given: 'the disposable prepared browser launcher',
    should:
      'never run apt, reuse a trust database, or bypass certificate verification',
    actual: {
      apt: /apt-get|apt install/.test(shell),
      fresh: shell.includes('certutil -N'),
      import: shell.includes('-i /fixture/ca.crt'),
      nonroot: shell.includes('exec runuser -u pwuser'),
    },
    expected: { apt: false, fresh: true, import: true, nonroot: true },
  });
});

test('prepared runtime cannot acquire an image or relax the sandbox contract', () => {
  const args = launchBrowserDockerArgs({ ...input, hostNetwork: false });
  assert({
    given: 'a validated prepared image ID',
    should:
      'refuse runtime pulls and retain init, shm, seccomp and readonly fixture mounts',
    actual: {
      pull: args.includes('--pull=never'),
      init: args.includes('--init'),
      shm: args.includes('--shm-size=512m'),
      seccomp: valueAfter(args, '--security-opt'),
      mounts: valueAfter(args, '-v'),
      unsafe: args.some((arg) =>
        /privileged|NET_ADMIN|ignore-certificate|no-sandbox/.test(arg),
      ),
    },
    expected: {
      pull: true,
      init: true,
      shm: true,
      seccomp: ['seccomp=/repo/seccomp.json'],
      mounts: ['/repo:/workspace:ro', '/tmp/ca.crt:/fixture/ca.crt:ro'],
      unsafe: false,
    },
  });
});
