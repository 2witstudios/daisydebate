import { connect } from 'node:net';
import { createAppError } from '@daisy/errors';
import type { FileScanner } from './ports';
/** ClamAV INSTREAM: bounded chunks, fail closed on every inconclusive reply. */
export function createClamdScanner(endpoint: {
  readonly host: string;
  readonly port: number;
}): FileScanner {
  if (
    !endpoint.host ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535
  )
    throw createAppError('INFRASTRUCTURE');
  return {
    async scan(bytes, limits) {
      if (
        !Number.isSafeInteger(limits.maxBytes) ||
        limits.maxBytes < 1 ||
        !Number.isSafeInteger(limits.serviceMs) ||
        limits.serviceMs < 1
      )
        throw createAppError('INFRASTRUCTURE');
      if (bytes.byteLength < 1 || bytes.byteLength > limits.maxBytes)
        throw createAppError('PAYLOAD_TOO_LARGE');
      return new Promise<'clean' | 'infected'>((resolve, reject) => {
        const socket = connect(endpoint);
        let response = '';
        let settled = false;
        const finish = (result?: 'clean' | 'infected') => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          if (result) resolve(result);
          else reject(createAppError('INFRASTRUCTURE'));
        };
        const timer = setTimeout(() => finish(), limits.serviceMs);
        socket.on('error', () => finish());
        socket.on('end', () => finish());
        socket.on('data', (chunk: Buffer) => {
          response += chunk.toString('utf8');
          if (response.length > 4096) {
            finish();
            return;
          }
          const end = response.indexOf('\0');
          if (end === -1) return;
          const reply = response.slice(0, end);
          finish(
            reply === 'stream: OK'
              ? 'clean'
              : /^stream: [^\r\n\0]+ FOUND$/u.test(reply)
                ? 'infected'
                : undefined,
          );
        });
        socket.on('connect', () => {
          socket.write('zINSTREAM\0');
          // One bounded chunk, followed by the protocol's zero-length terminator.
          const length = Buffer.alloc(4);
          length.writeUInt32BE(bytes.byteLength);
          socket.write(length);
          socket.write(bytes);
          socket.write(Buffer.alloc(4));
        });
      });
    },
  };
}
