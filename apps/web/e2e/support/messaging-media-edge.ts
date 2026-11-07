import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLaunchCertificates } from './launch-certificates';
import { createLaunchSocketEdge } from './launch-socket-edge';
import { requireLaunchSlot } from './room-launch-slot';

const slot = requireLaunchSlot(
  resolve(import.meta.dir, '../../../..'),
  process.env,
);
const certificates = createLaunchCertificates();
// The floor proof keeps an actual media session alive beside the native messaging socket.
const edge = (() => {
  try {
    return createLaunchSocketEdge({
      port: slot.port + 7,
      upstreamPort: 7880,
      tls: {
        key: readFileSync(certificates.key),
        cert: readFileSync(certificates.cert),
      },
    });
  } finally {
    certificates.close();
  }
})();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    edge.stop(true);
    process.exit(0);
  });
