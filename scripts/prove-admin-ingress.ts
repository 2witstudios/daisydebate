#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

// An isolated, never-authenticated node: no network, real daemon and image,
// unique empty storage, and no application database connection is needed.
const image = process.argv[2];
if (!image) throw new Error('Pass the built admin image');
const name = `daisy-admin-ingress-proof-${randomBytes(8).toString('hex')}`;
const volume = `${name}-state`;
const docker = (args: readonly string[]) =>
  execFileSync('docker', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
let created = false;
try {
  docker(['volume', 'create', volume]);
  docker([
    'run',
    '--detach',
    '--name',
    name,
    '--network',
    'none',
    '--mount',
    `type=volume,source=${volume},target=/var/lib/tailscale`,
    '--env',
    'ADMIN_ORIGIN=https://daisy-admin.tail51baf2.ts.net',
    '--env',
    'ADMIN_DATABASE_URL=postgres://unused:unused@localhost/unused',
    '--env',
    'ADMIN_ATTEMPT_KEY=isolated-ingress-proof-not-a-secret-0000000',
    image,
  ]);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const running = docker(['inspect', '--format', '{{.State.Running}}', name]);
    if (running !== 'true')
      throw new Error('Ingress exited while awaiting registration');
    try {
      const state = JSON.parse(
        docker([
          'exec',
          name,
          'tailscale',
          '--socket=/run/tailscale/tailscaled.sock',
          'status',
          '--json',
        ]),
      ) as { BackendState?: string };
      ready = state.BackendState === 'NeedsLogin';
    } catch {
      /* The private socket may not exist yet. */
    }
    if (ready) break;
    await setTimeout(200);
  }
  if (!ready)
    throw new Error('Ingress never exposed its private registration socket');
  const writable = docker([
    'exec',
    '--user',
    'daisy',
    name,
    'find',
    '/app',
    '-writable',
    '!',
    '-path',
    '/app/apps/admin/.next/cache',
    '!',
    '-path',
    '/app/apps/admin/.next/cache/*',
  ]);
  if (writable !== '')
    throw new Error(
      `App can rewrite root-executed code or dependencies (paths only):\n${writable}`,
    );
  docker([
    'exec',
    '--user',
    'daisy',
    name,
    'bun',
    '-e',
    'import { writeFileSync, unlinkSync, accessSync, constants } from "node:fs"; const file = "/app/apps/admin/.next/cache/permission-proof"; writeFileSync(file, "fixture"); unlinkSync(file); for (const path of ["/var/lib/tailscale", "/run/tailscale"]) { let denied = false; try { accessSync(path, constants.R_OK | constants.X_OK); } catch { denied = true; } if (!denied) process.exit(1); }',
  ]);
  docker([
    'exec',
    '--user',
    'daisy',
    name,
    'bun',
    '-e',
    `
    import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
    const denied = (operation) => {
      try { operation(); } catch (error) {
        if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) return;
        throw error;
      }
      throw new Error('App rewrote root startup code or ancestor');
    };
    const startup = '/app/apps/admin/src/server/private-ingress.sh';
    const config = '/app/apps/admin/src/config.ts';
    const cache = '/app/apps/admin/.next/cache/replace-proof';
    denied(() => writeFileSync(startup, 'replacement'));
    denied(() => writeFileSync(config, 'replacement'));
    writeFileSync(cache, 'replacement');
    denied(() => renameSync(cache, startup));
    denied(() => unlinkSync(config));
    for (const path of ['/app', '/app/apps', '/app/apps/admin', '/app/apps/admin/src', '/app/apps/admin/src/server', '/app/node_modules']) {
      denied(() => writeFileSync(path + '/replacement-proof', 'replacement'));
      denied(() => renameSync(path, '/tmp/ancestor-proof'));
    }
    unlinkSync(cache);
  `,
  ]);
  const backend = docker([
    'exec',
    name,
    'bun',
    '-e',
    'try { await fetch("http://127.0.0.1:8080"); process.exit(1); } catch { process.exit(0); }',
  ]);
  if (backend !== '') throw new Error('Unexpected backend proof output');
  if (/login\.tailscale|https:\/\/.*\/a\//i.test(docker(['logs', name])))
    throw new Error('Ingress logged an authentication URL');
  docker(['stop', '--time', '20', name]);
  if (docker(['inspect', '--format', '{{.State.ExitCode}}', name]) !== '0')
    throw new Error('Ingress did not drain cleanly');
  process.stdout.write(
    'PASS: real image stays awaiting login with private socket, no app listener or login URL logs, immutable root code/dependencies and private state under app UID, writable cache, and clean shutdown\n',
  );
} finally {
  if (created) docker(['rm', '--force', name]);
  docker(['volume', 'rm', volume]);
}
