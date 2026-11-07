import { createTigrisObjectStore } from '../src/features/recording/tigris-object-store';

type TransferEvent = {
  readonly token: number;
  readonly kind: 'enter' | 'sent' | 'cancelled';
  readonly atMs: number;
};
const hash = (bytes: Uint8Array) =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/** Controlled TEST receiver, not a Tigris/S3 server qualification. Only exact links
 * issued by the real signer are accepted; no credentials or URLs enter receipts. */
export async function withDownloadTransport(
  work: (transport: ReturnType<typeof downloadTransport>) => Promise<void>,
) {
  const transport = downloadTransport();
  try {
    await work(transport);
  } finally {
    transport.close();
  }
}

function downloadTransport() {
  const files = new Map<string, Uint8Array>();
  const issued = new Map<
    string,
    { readonly key: string; readonly until: number }
  >();
  const events: TransferEvent[] = [];
  const receipts: {
    readonly bytes: number;
    readonly sha256: string;
    readonly atMs: number;
  }[] = [];
  let next = 0;
  let gate = Promise.resolve();
  const releases = new Set<() => void>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const grant = issued.get(url.pathname + url.search);
      if (request.method !== 'GET' || !grant || grant.until < Date.now())
        return new Response(null, { status: 403 });
      const bytes = files.get(grant.key);
      if (!bytes) return new Response(null, { status: 404 });
      const token = ++next;
      events.push({ token, kind: 'enter', atMs: performance.now() });
      const wait = gate;
      let offset = 0,
        ended = false;
      const finish = (kind: 'sent' | 'cancelled') => {
        if (ended) return;
        ended = true;
        events.push({ token, kind, atMs: performance.now() });
      };
      request.signal.addEventListener('abort', () => finish('cancelled'), {
        once: true,
      });
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (offset > 0) await wait;
            if (ended) {
              controller.close();
              return;
            }
            if (offset === bytes.length) {
              finish('sent');
              controller.close();
              return;
            }
            const chunkSize = Math.max(
              1,
              Math.min(1024, Math.floor(bytes.length / 4)),
            );
            const end = Math.min(bytes.length, offset + chunkSize);
            controller.enqueue(bytes.slice(offset, end));
            offset = end;
          },
          cancel() {
            finish('cancelled');
          },
        }),
        {
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(bytes.length),
          },
        },
      );
    },
  });
  const store = createTigrisObjectStore({
    endpoint: `http://127.0.0.1:${server.port}`,
    bucket: 'ac3-private',
    accessKeyId: 'TEST-only',
    secretAccessKey: 'TEST-only-noncredential',
    region: 'auto',
  });
  const facts = () => {
    const active = new Set<number>();
    let peak = 0,
      attempts = 0;
    for (const event of events) {
      if (event.kind === 'enter') {
        active.add(event.token);
        attempts++;
        peak = Math.max(peak, active.size);
      } else if (!active.delete(event.token))
        throw Error('Download settlement lacks entry');
    }
    return {
      attempts,
      completed: receipts.length,
      bytes: receipts.reduce((n, r) => n + r.bytes, 0),
      peak,
      active: active.size,
    };
  };
  return {
    objects: {
      ...store,
      signedRead: (
        key: string,
        options: Parameters<typeof store.signedRead>[1],
      ) => {
        const link = store.signedRead(key, options),
          url = new URL(link);
        issued.set(url.pathname + url.search, {
          key,
          until: Date.now() + options.expiresInSeconds * 1000,
        });
        return link;
      },
    },
    put: (key: string, bytes: Uint8Array) => {
      files.set(key, bytes.slice());
    },
    async receive(url: string, expected: Uint8Array) {
      const response = await fetch(url);
      if (!response.ok)
        throw Error('Controlled authorized object request refused');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const sha256 = hash(bytes);
      if (bytes.length !== expected.length || sha256 !== hash(expected))
        throw Error(
          'Download client did not receive the complete expected object',
        );
      receipts.push({ bytes: bytes.length, sha256, atMs: performance.now() });
    },
    hold() {
      const held = Promise.withResolvers<void>();
      gate = held.promise;
      const release = () => {
        held.resolve();
        releases.delete(release);
      };
      releases.add(release);
      return release;
    },
    async waitActive(expected: number) {
      const deadline = performance.now() + 3000;
      while (facts().active !== expected) {
        if (performance.now() > deadline)
          throw Error('Download interval observation deadline');
        await Bun.sleep(5);
      }
    },
    events,
    receipts,
    facts,
    close() {
      for (const release of releases) release();
      server.stop(true);
    },
  };
}
