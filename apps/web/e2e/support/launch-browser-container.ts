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
  const child = Bun.spawn(
    [
      'docker',
      'run',
      '--rm',
      '--init',
      '--name',
      name,
      '--shm-size=512m',
      '--security-opt',
      `seccomp=${resolve(import.meta.dir, 'launch-browser-seccomp.json')}`,
      '-p',
      '127.0.0.1::3400',
      '-v',
      `${input.checkout}:/workspace:ro`,
      '-v',
      `${input.ca}:/fixture/ca.crt:ro`,
      '-e',
      `DAISY_BROWSER_FORWARD_PORTS=${JSON.stringify(input.ports)}`,
      '-e',
      'NODE_EXTRA_CA_CERTS=/fixture/ca.crt',
      `mcr.microsoft.com/playwright:v${version}-noble`,
      'sh',
      '/workspace/apps/web/e2e/support/launch-browser-container.sh',
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
        endpoint.resolve(new URL(match[1]!).pathname);
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
    let endpointPath: string;
    try {
      endpointPath = await Promise.race([
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
