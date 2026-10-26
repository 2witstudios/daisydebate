import { createId } from '@paralleldrive/cuid2';
import { resolve } from 'node:path';

/** Existing pinned browser image, with trust and network resources confined to its owned container. */
export async function createLaunchBrowserContainer(input: {
  readonly checkout: string;
  readonly ca: string;
  readonly ports: readonly number[];
}) {
  const name = `daisy-browser-${createId()}`;
  const version = JSON.parse(
    await Bun.file(resolve(input.checkout, 'apps/web/package.json')).text(),
  ).devDependencies['@playwright/test'];
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Invalid pinned browser image version');
  // Linux has no host.docker.internal route to loopback-only services, so
  // the container shares the host network there instead of forwarding.
  const hostNetwork = process.platform === 'linux';
  const child = Bun.spawn(
    [
      'docker',
      ...launchBrowserDockerArgs({
        name,
        version,
        checkout: input.checkout,
        ca: input.ca,
        seccomp: resolve(import.meta.dir, 'launch-browser-seccomp.json'),
        ports: input.ports,
        hostNetwork,
      }),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const endpoint = Promise.withResolvers<string>();
  const output = (async () => {
    const decoder = new TextDecoder();
    let text = '',
      listening = false;
    for await (const chunk of child.stdout) {
      text += decoder.decode(chunk, { stream: true });
      const match = text.match(/Listening on (ws:\/\/[^\s]+)/);
      if (match) {
        listening = true;
        endpoint.resolve(match[1]!);
      }
      if (text.length > 8192) text = text.slice(-8192);
    }
    throw new Error(
      listening
        ? 'Isolated browser server exited'
        : 'Isolated browser server did not start',
    );
  })();
  const close = async () => {
    const stopped = Bun.spawn(['docker', 'stop', '--time', '10', name], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await stopped.exited;
    await child.exited;
  };
  try {
    let timer: ReturnType<typeof setTimeout>;
    let listening: string;
    try {
      listening = await Promise.race([
        endpoint.promise,
        output,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Isolated browser startup deadline')),
            120000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
    // On the host network the server's own loopback endpoint is the binding.
    if (hostNetwork) return { endpoint: listening, close };
    const endpointPath = new URL(listening).pathname;
    const inspected = Bun.spawn(
      [
        'docker',
        'inspect',
        '--format',
        '{{json .NetworkSettings.Ports}}',
        name,
      ],
      { stdout: 'pipe', stderr: 'ignore' },
    );
    const raw = await new Response(inspected.stdout).text();
    if ((await inspected.exited) !== 0)
      throw new Error('Isolated browser binding unavailable');
    const port = JSON.parse(raw)['3400/tcp']?.[0]?.HostPort;
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      throw new Error('Invalid isolated browser binding');
    return { endpoint: `ws://127.0.0.1:${port}${endpointPath}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** The `docker run` arguments for the pinned browser image, forwarded or on the host network. */
export function launchBrowserDockerArgs(input: {
  readonly name: string;
  readonly version: string;
  readonly checkout: string;
  readonly ca: string;
  readonly seccomp: string;
  readonly ports: readonly number[];
  readonly hostNetwork: boolean;
}): readonly string[] {
  return [
    'run',
    '--rm',
    '--init',
    '--name',
    input.name,
    '--shm-size=512m',
    '--security-opt',
    `seccomp=${input.seccomp}`,
    ...(input.hostNetwork ? ['--network', 'host'] : ['-p', '127.0.0.1::3400']),
    '-v',
    `${input.checkout}:/workspace:ro`,
    '-v',
    `${input.ca}:/fixture/ca.crt:ro`,
    '-e',
    `DAISY_BROWSER_NETWORK=${input.hostNetwork ? 'host' : 'forwarded'}`,
    '-e',
    `DAISY_BROWSER_FORWARD_PORTS=${JSON.stringify(input.hostNetwork ? [] : input.ports)}`,
    '-e',
    'NODE_EXTRA_CA_CERTS=/fixture/ca.crt',
    `mcr.microsoft.com/playwright:v${input.version}-noble`,
    'sh',
    '/workspace/apps/web/e2e/support/launch-browser-container.sh',
  ];
}
