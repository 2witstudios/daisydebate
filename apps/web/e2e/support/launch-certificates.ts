import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Command = readonly string[];
/** Ephemeral local CA, trusted only by this proof's Bun processes and disposable browser container. */
export function createLaunchCertificates() {
  const directory = mkdtempSync(join(tmpdir(), 'daisy-launch-ca-'));
  chmodSync(directory, 0o700);
  const at = (name: string) => join(directory, name);
  const run = (command: Command) => {
    const result = Bun.spawnSync([...command], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if (result.exitCode !== 0)
      throw new Error('Local proof certificate creation failed');
  };
  try {
    run([
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      at('ca.key'),
      '-out',
      at('ca.crt'),
      '-subj',
      '/CN=Daisy isolated proof CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    run([
      'openssl',
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      at('server.key'),
      '-out',
      at('server.csr'),
      '-subj',
      '/CN=localhost',
    ]);
    writeFileSync(
      at('server.ext'),
      'subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
      { mode: 0o600 },
    );
    run([
      'openssl',
      'x509',
      '-req',
      '-in',
      at('server.csr'),
      '-CA',
      at('ca.crt'),
      '-CAkey',
      at('ca.key'),
      '-CAcreateserial',
      '-days',
      '1',
      '-extfile',
      at('server.ext'),
      '-out',
      at('server.crt'),
    ]);
    // No signer is needed once the fixture leaf is issued.
    for (const name of ['ca.key', 'server.csr', 'server.ext', 'ca.srl'])
      rmSync(at(name), { force: true });
    chmodSync(at('server.key'), 0o600);
    return {
      directory,
      ca: at('ca.crt'),
      cert: at('server.crt'),
      key: at('server.key'),
      close: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
export const readLaunchTls = (
  env: Readonly<Record<string, string | undefined>>,
) => {
  const cert = env.E2E_LOCAL_TLS_CERT,
    key = env.E2E_LOCAL_TLS_KEY;
  if (!cert || !key)
    throw new Error('Launch proof requires its local trusted certificate');
  return { cert: readFileSync(cert), key: readFileSync(key) };
};
