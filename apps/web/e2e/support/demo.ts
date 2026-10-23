import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLaunchCertificates } from './launch-certificates';
import { requireLaunchSlot } from './room-launch-slot';

/**
 * A local demo: the production build behind the existing room-launch
 * composition (TLS edges, realtime, LiveKit, mail capture, the attendance
 * probe) for real people in real browsers. See docs/development/demo.md.
 * The outer run mints the demo certificate and runs this file again with it
 * in its environment; that inner run starts the room-launch server.
 */
const checkout = resolve(import.meta.dir, '../../../..');
const slot = requireLaunchSlot(checkout, process.env);
const origin = `https://localhost:${slot.port + 1}`;

/** Inner run: the room-launch config reads the certificate environment on load. */
async function serve() {
  const config = (await import('./room-launch-config')).default;
  const server = [config.webServer].flat()[0]!;
  // Its own process group, so stopping the demo reaches the server the
  // harness command starts, not only the shell around it.
  const child = spawn('sh', ['-c', server.command], {
    cwd: server.cwd ?? checkout,
    env: { ...process.env, ...server.env },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  // The terminal's SIGINT and the outer run's SIGTERM both arrive: stop once,
  // and a group that has already exited is already stopped.
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, stop);
  process.exitCode = await new Promise<number>((done) =>
    child.once('exit', (code) => done(code ?? 1)),
  );
}

/** The leaf key's SHA-256 SPKI pin: Chrome trusts this one certificate only. */
const spkiPin = (cert: string) =>
  Bun.spawnSync([
    'sh',
    '-c',
    `openssl x509 -in '${cert}' -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64`,
  ])
    .stdout.toString()
    .trim();

async function waitReady(ca: string, server: Bun.Subprocess) {
  const trusted = await Bun.file(ca).text();
  for (let attempt = 0; attempt < 360; attempt++) {
    if (server.exitCode !== null) break;
    const ok = await fetch(`${origin}/api/health/ready`, {
      tls: { ca: trusted },
    }).then(
      (answer) => answer.ok,
      () => false,
    );
    if (ok) return;
    await Bun.sleep(500);
  }
  throw new Error(
    'The demo server did not become ready; see apps/web/test-results/',
  );
}

/** Outer run: certificate, inner server, readiness, then instructions. */
async function demo() {
  if (!existsSync(resolve(checkout, 'apps/web/.next/BUILD_ID')))
    throw new Error(
      'Run `bun run build` first: the demo serves the production build',
    );
  const certificates = createLaunchCertificates();
  const server = Bun.spawn(['bun', import.meta.path], {
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: certificates.ca,
      E2E_LOCAL_TLS_CERT: certificates.cert,
      E2E_LOCAL_TLS_KEY: certificates.key,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => server.kill('SIGTERM'));
  try {
    await waitReady(certificates.ca, server);
    const pin = spkiPin(certificates.cert);
    const profiles = mkdtempSync(join(tmpdir(), 'daisy-demo-'));
    const chrome = (person: string) =>
      `${process.platform === 'darwin' ? 'open -na "Google Chrome" --args' : 'google-chrome'} --user-data-dir='${profiles}/${person}' --ignore-certificate-errors-spki-list=${pin} ${origin}`;
    process.stdout.write(
      [
        '',
        `Daisy demo is ready at ${origin}`,
        '',
        'Open one isolated browser profile per person (each trusts only this demo certificate):',
        `  ${chrome('person-a')}`,
        `  ${chrome('person-b')}`,
        '',
        'Request a sign-in link on the page, then print it with:',
        '  bun demo:link <email>',
        '',
        'Ctrl-C stops the demo.',
        '',
      ].join('\n'),
    );
    await server.exited;
  } finally {
    // A readiness failure must not leave the inner run holding the slot's ports.
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await server.exited;
    }
    certificates.close();
  }
}

await (process.env.E2E_LOCAL_TLS_CERT ? serve() : demo());
