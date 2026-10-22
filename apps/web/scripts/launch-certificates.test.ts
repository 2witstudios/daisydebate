import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createLaunchCertificates,
  readLaunchTls,
} from '../e2e/support/launch-certificates';
setupRitewayBun();
test('isolated proof CA is actually required for the production Bun HTTPS client', async () => {
  const certificates = createLaunchCertificates();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    tls: readLaunchTls({
      E2E_LOCAL_TLS_CERT: certificates.cert,
      E2E_LOCAL_TLS_KEY: certificates.key,
    }),
    fetch: () => new Response('Actual TLS'),
  });
  const call = async (ca: string | undefined) => {
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        'await fetch(Bun.argv[1]).then(r=>{if(r.status!==200)process.exit(2)}).catch(()=>process.exit(1))',
        `https://localhost:${server.port}`,
      ],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: ca,
          NODE_TLS_REJECT_UNAUTHORIZED: undefined,
        },
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    return child.exited;
  };
  try {
    assert({
      given: 'the same real HTTPS listener without and with its isolated CA',
      should:
        'refuse untrusted TLS and succeed only with chain validation enabled',
      actual: [await call(undefined), await call(certificates.ca)],
      expected: [1, 0],
    });
  } finally {
    server.stop(true);
    certificates.close();
  }
});
