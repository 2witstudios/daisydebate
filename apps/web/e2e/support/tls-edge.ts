import { readFileSync } from 'node:fs';
import { createLaunchCertificates } from './launch-certificates';

/**
 * A loopback TLS edge in front of a plain-HTTP production app instance:
 * production configuration requires an HTTPS origin (Secure session
 * cookies need one in a real client), so every local production-mode
 * server this repo starts — the browser suite's server and the AUTH-6.7
 * load harness's instances — fronts itself with one of these. The
 * certificate is issued by a per-call local CA in a private temporary
 * directory and deleted once loaded, so the private key never sits on disk
 * under any directory a test artifact upload could pick up (ISSUE-78).
 *
 * `appPort` may be several ports: each request round-robins across them,
 * one public origin load-balancing across backend processes, which is how
 * the AUTH-6.7 load harness presents its two application instances as the
 * one origin every session, cookie and origin check must agree on.
 */
export function createSelfSignedTlsEdge({
  appPort,
  edgePort,
  hostname = '127.0.0.1',
  tls: suppliedTls,
  beforeForward,
  selectAppPort,
}: {
  readonly appPort: number | readonly number[];
  readonly edgePort: number;
  readonly hostname?: string;
  readonly tls?: { readonly key: Buffer; readonly cert: Buffer };
  readonly beforeForward?: (request: Request) => Response | null;
  readonly selectAppPort?: () => number;
}) {
  const appPorts = Array.isArray(appPort) ? appPort : [appPort as number];
  let next = 0;
  const nextAppPort = () => {
    const port = appPorts[next % appPorts.length];
    next += 1;
    return port;
  };
  const generateTls = () => {
    const certificates = createLaunchCertificates();
    try {
      return {
        key: readFileSync(certificates.key),
        cert: readFileSync(certificates.cert),
      };
    } finally {
      certificates.close();
    }
  };
  const tls = suppliedTls ?? generateTls();

  const server = Bun.serve({
    hostname,
    port: edgePort,
    tls: { key: tls.key, cert: tls.cert },
    async fetch(request) {
      const blocked = beforeForward?.(request);
      if (blocked) return blocked;
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.set('x-forwarded-proto', 'https');
      const upstream = await fetch(
        `http://127.0.0.1:${selectAppPort?.() ?? nextAppPort()}${url.pathname}${url.search}`,
        {
          method: request.method,
          headers,
          body: request.body,
          redirect: 'manual',
          // @ts-expect-error Bun: stream a request body through the proxy.
          duplex: 'half',
        },
      );
      // fetch has already decoded the body, so its encoding headers are stale.
      const answered = new Headers(upstream.headers);
      answered.delete('content-encoding');
      answered.delete('content-length');
      return new Response(upstream.body, {
        status: upstream.status,
        headers: answered,
      });
    },
  });
  return {
    /** The bound port: `edgePort` itself, or the one chosen for port 0. */
    port: server.port,
    stop: (closeActiveConnections?: boolean) =>
      server.stop(closeActiveConnections),
  };
}
