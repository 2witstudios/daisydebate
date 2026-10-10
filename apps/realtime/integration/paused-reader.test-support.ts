import { connect } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { serverMessageSchema, type ServerMessage } from '@daisy/protocol';
import type { SocketData } from '../src/socket';
import { testOrigin, waitFor } from './support';

/** Observe the actual Bun socket while preserving all native handlers and authorization. */
export function observeNativeServe(
  onOpen: (socket: Bun.ServerWebSocket<SocketData>) => void,
): typeof Bun.serve {
  return ((options: Bun.Serve.Options<SocketData>) => {
    const { unix, ...tcp } = options;
    if (unix)
      throw new Error('Paused-reader requires an isolated TCP listener');
    const native = options.websocket;
    if (!native) throw new Error('Native websocket handlers unavailable');
    return Bun.serve({
      ...tcp,
      hostname: '127.0.0.1',
      websocket: {
        ...native,
        open(socket) {
          native.open?.(socket);
          onOpen(socket);
        },
      },
    });
  }) as typeof Bun.serve;
}

function maskedFrame(payload: Buffer, opcode = 1): Buffer {
  const prefix = Buffer.alloc(payload.length < 126 ? 2 : 4);
  prefix[0] = 0x80 | opcode;
  prefix[1] = 0x80 | (payload.length < 126 ? payload.length : 126);
  if (payload.length >= 126) prefix.writeUInt16BE(payload.length, 2);
  const mask = randomBytes(4);
  const body = Buffer.from(payload);
  for (let index = 0; index < body.length; index++)
    body[index] = body[index]! ^ mask[index % 4]!;
  return Buffer.concat([prefix, mask, body]);
}

function frameSize(bytes: Buffer) {
  if (bytes.length < 2) return null;
  const short = bytes[1]! & 127;
  const header = short === 127 ? 10 : short === 126 ? 4 : 2;
  if (bytes.length < header) return null;
  const length =
    short === 127
      ? Number(bytes.readBigUInt64BE(2))
      : short === 126
        ? bytes.readUInt16BE(2)
        : short;
  if (!Number.isSafeInteger(length) || length > 1_048_576)
    throw new Error('Native paused-reader frame exceeds its proof bound');
  return bytes.length >= header + length ? { header, length } : null;
}

/** A physical TCP reader that can stop consuming bytes after real RFC6455 authentication. */
export async function pausedNativePeer(port: number) {
  const socket = connect({ host: '127.0.0.1', port });
  const key = randomBytes(16).toString('base64');
  // RFC6455 mandates SHA-1 for this public upgrade nonce, not stored bearer material.
  const expectedAccept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  let bytes = Buffer.alloc(0);
  let upgraded = false;
  let failure = false;
  let closeCode: number | undefined;
  const frames: ServerMessage[] = [];
  const consumeFrame = (opcode: number, payload: Buffer) => {
    if (opcode === 8) {
      closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      socket.end(maskedFrame(payload, 8));
    } else if (opcode === 1)
      frames.push(
        serverMessageSchema.parse(JSON.parse(payload.toString()), {
          jitless: true,
        }),
      );
  };
  const consume = () => {
    if (!upgraded) {
      const end = bytes.indexOf('\r\n\r\n');
      if (end < 0) return;
      const headers = bytes.subarray(0, end).toString();
      const accept = headers
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('sec-websocket-accept:'))
        ?.split(':')[1]
        ?.trim();
      if (!headers.startsWith('HTTP/1.1 101') || accept !== expectedAccept)
        throw new Error('Native paused-reader upgrade refused');
      bytes = bytes.subarray(end + 4);
      upgraded = true;
    }
    for (let size = frameSize(bytes); size; size = frameSize(bytes)) {
      consumeFrame(
        bytes[0]! & 15,
        bytes.subarray(size.header, size.header + size.length),
      );
      bytes = bytes.subarray(size.header + size.length);
    }
  };
  socket.on('data', (chunk) => {
    bytes = Buffer.concat([bytes, chunk]);
    try {
      consume();
    } catch {
      failure = true;
      socket.destroy();
    }
  });
  socket.on('error', () => {
    failure = true;
  });
  socket.on('connect', () =>
    socket.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${testOrigin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
    ),
  );
  await waitFor(() => upgraded || failure);
  if (failure) throw new Error('Native paused-reader connection unavailable');
  return {
    frames,
    send(frame: unknown) {
      socket.write(maskedFrame(Buffer.from(JSON.stringify(frame))));
    },
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    destroy: () => socket.destroy(),
    async closed() {
      await waitFor(() => closeCode !== undefined || failure);
      if (failure || closeCode === undefined)
        throw new Error('Native paused-reader close unavailable');
      return closeCode;
    },
  };
}

export async function fillNativeBuffer(
  socket: Bun.ServerWebSocket<SocketData>,
  frame: ServerMessage,
) {
  const serialized = JSON.stringify(frame);
  // Bounded physical traffic, with actual OS and Bun buffers observed each chunk.
  for (let count = 0; count < 100_000; count++) {
    socket.send(serialized);
    if (socket.getBufferedAmount() > 262_144) return;
    if (count % 128 === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Physical paused-reader did not reach the soft buffer bound');
}
