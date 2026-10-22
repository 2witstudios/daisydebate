import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createSelfSignedTlsEdge } from '../e2e/support/tls-edge';
import {
  createLaunchCertificates,
  readLaunchTls,
} from '../e2e/support/launch-certificates';
setupRitewayBun();

test('trusted HTTPS ingress continues through a selected live peer when the previous backend closes', async () => {
  const certificates = createLaunchCertificates();
  const backends = ['primary', 'peer'].map((name) =>
    Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response(name),
    }),
  );
  let selected = backends[0]!.port!;
  const edge = createSelfSignedTlsEdge({
    appPort: selected,
    edgePort: 0,
    tls: readLaunchTls({
      E2E_LOCAL_TLS_CERT: certificates.cert,
      E2E_LOCAL_TLS_KEY: certificates.key,
    }),
    selectAppPort: () => selected,
  });
  const read = async () =>
    (
      await fetch(`https://localhost:${edge.port}`, {
        tls: { ca: await Bun.file(certificates.ca).text() },
      })
    ).text();
  try {
    const first = await read();
    selected = backends[1]!.port!;
    backends[0]!.stop(true);
    assert({
      given:
        'two actual listeners and a validated TLS edge switched to the live listener',
      should: 'keep serving the selected peer after the former listener stops',
      actual: [first, await read()],
      expected: ['primary', 'peer'],
    });
  } finally {
    edge.stop(true);
    backends.forEach((server) => server.stop(true));
    certificates.close();
  }
});
