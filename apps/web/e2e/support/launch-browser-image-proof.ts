import { createId } from '@paralleldrive/cuid2';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLaunchCertificates, readLaunchTls } from './launch-certificates';
import { createLaunchBrowserContainer } from './launch-browser-container';
import { prepareLaunchBrowserImage } from './launch-browser-image';

const checkout = resolve(import.meta.dir, '../../../..');
const certificates: ReturnType<typeof createLaunchCertificates>[] = [];
const servers: ReturnType<typeof startProofTls>[] = [];
function startProofTls(
  certificate: ReturnType<typeof createLaunchCertificates>,
) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    tls: readLaunchTls({
      E2E_LOCAL_TLS_CERT: certificate.cert,
      E2E_LOCAL_TLS_KEY: certificate.key,
    }),
    fetch(request, server) {
      if (new URL(request.url).pathname === '/ws' && server.upgrade(request))
        return;
      return new Response(
        '<!doctype html><title>Prepared browser trust proof</title>',
      );
    },
    websocket: {
      message(socket, message) {
        socket.send(message);
      },
    },
  });
}
const run = async (args: readonly string[]) => {
  const child = Bun.spawn([...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error('Prepared Launch browser proof command failed');
  return stdout;
};
try {
  const prepared = await prepareLaunchBrowserImage({ checkout });
  // Warm reuse must not create any build backend or enter apt.
  const warm = await prepareLaunchBrowserImage({ checkout });
  if (warm.id !== prepared.id)
    throw new Error('Warm prepared image identity changed');
  for (let index = 0; index < 2; index += 1) {
    const certificate = createLaunchCertificates();
    certificates.push(certificate);
    servers.push(startProofTls(certificate));
  }
  const ports = servers.map((server) => server.port!);
  const repositoryHosts = (
    await run([
      'docker',
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--entrypoint',
      'cat',
      prepared.id,
      '/usr/local/share/daisy-launch-repositories.txt',
    ])
  )
    .trim()
    .split(/\s+/);
  for (const index of [0, 1]) {
    const browser = await createLaunchBrowserContainer({
      checkout,
      image: prepared.id,
      ca: certificates[index]!.ca,
      proofRepositoryHosts: repositoryHosts,
      ports,
    });
    try {
      // Every configured apt repository is mapped to a closed container
      // loopback endpoint before browser startup; fixture forwarders still work.
      await run([
        'docker',
        'exec',
        '--user',
        'pwuser',
        browser.name,
        'node',
        '-e',
        `
        const fs=require('node:fs'), http=require('node:http'), https=require('node:https');
        const hosts=fs.readFileSync('/usr/local/share/daisy-launch-repositories.txt','utf8').trim().split(/\\s+/);
        if(!hosts.length)process.exit(2);
        Promise.all(hosts.flatMap(host=>[http,https].map(client=>new Promise((resolve,reject)=>{
          const request=client.get(client===http?'http://'+host:'https://'+host,()=>reject(Error('Repository reachable')));
          request.setTimeout(2000,()=>request.destroy(Error('Repository request timed out')));
          request.on('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
        })))).catch(()=>process.exit(1));
      `,
      ]);
      const node = process.env.ROOM_LAUNCH_NODE ?? 'node';
      const driver = Bun.spawn(
        [
          node,
          resolve(import.meta.dir, 'launch-browser-image-proof.mjs'),
          browser.endpoint,
          String(ports[index]),
          String(ports[1 - index]),
        ],
        { stdout: 'inherit', stderr: 'inherit' },
      );
      if ((await driver.exited) !== 0)
        throw new Error('Prepared browser strict TLS/WSS/media proof failed');
    } finally {
      await browser.close();
    }
    const inspected = Bun.spawnSync(
      ['docker', 'container', 'inspect', browser.name],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    if (inspected.exitCode === 0)
      throw new Error('Prepared browser container leaked');
  }
  const failedName = `daisy-browser-${createId()}`;
  const missingCa = resolve(certificates[0]!.directory, 'missing-ca.crt');
  const refused = await createLaunchBrowserContainer({
    checkout,
    name: failedName,
    image: prepared.id,
    ca: missingCa,
    ports,
  }).then(
    async (created) => {
      await created.close();
      return false;
    },
    () => true,
  );
  if (!refused) throw new Error('Missing fixture CA was accepted');
  const failedContainer = Bun.spawnSync(
    ['docker', 'container', 'inspect', failedName],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  if (failedContainer.exitCode === 0)
    throw new Error('Failed Launch browser container leaked');
  const inventory = await run([
    'docker',
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--entrypoint',
    'sh',
    prepared.id,
    '-ec',
    'test ! -e /fixture/ca.crt; test ! -e /usr/local/share/ca-certificates/daisy-isolated-proof.crt; test ! -e /home/pwuser/.local/share/pki/nssdb; cat /usr/local/share/daisy-launch-packages.txt',
  ]);
  process.stdout.write(
    `${JSON.stringify({
      event: 'browser.image.trust.proof',
      image: prepared.id,
      inputs: prepared.image.key,
      platform: prepared.image.platform,
      cases: [
        'fresh-ca-https-wss-media',
        'foreign-ca-rejected',
        'hostname-rejected',
        'cross-run-ca-isolation',
        'package-repositories-unreachable',
        'container-cleanup',
        'failed-start-cleanup',
        'image-trust-empty',
      ],
      packageInventory: inventory
        .trim()
        .split('\n')
        .filter((line) =>
          /^(libnss3(?:-tools)?|libnspr4|libc6|zlib1g|ca-certificates)(?::[a-z0-9]+)?\s/.test(
            line,
          ),
        ),
    })}\n`,
  );
} finally {
  for (const server of servers) server.stop(true);
  for (const certificate of certificates) certificate.close();
}
if (certificates.some((certificate) => existsSync(certificate.directory)))
  throw new Error('Prepared browser CA cleanup failed');
