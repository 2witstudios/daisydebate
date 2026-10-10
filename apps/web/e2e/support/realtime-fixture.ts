import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { resolveE2EPorts } from '../../playwright.config';
import type { ConnectionStore } from '../../src/features/realtime/connection-store';
import type { ServerMessage } from '@daisy/protocol';

declare global {
  interface Window {
    realtimeProof: {
      store: ConnectionStore;
      frames: ServerMessage[];
      release: () => void;
      sockets: WebSocket[];
      closeCodes: number[];
      transportFrames: ServerMessage[];
    };
  }
}
const adapter = resolve(
  import.meta.dirname,
  '../../src/features/realtime/browser-adapters.ts',
);
/** Bundles the actual generic browser adapter; no replacement socket or ticket reader. */
export function browserTransportSource() {
  const directory = mkdtempSync(join(tmpdir(), 'daisy-realtime-browser-'));
  try {
    const entry = join(directory, 'entry.ts');
    writeFileSync(
      entry,
      `import {createBrowserConnectionStore} from ${JSON.stringify(adapter)}; globalThis.createRealtimeProofStore=createBrowserConnectionStore;`,
    );
    return execFileSync(
      'bun',
      ['build', entry, '--target=browser', '--format=iife'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
export async function connectRoomTransport(
  page: Page,
  topic: string,
  source: string,
) {
  await page.evaluate(source);
  await page.evaluate(
    ({ topic, url }) => {
      const create = (
        globalThis as unknown as {
          createRealtimeProofStore: (url: string) => ConnectionStore;
        }
      ).createRealtimeProofStore;
      const sockets: WebSocket[] = [];
      const closeCodes: number[] = [];
      const NativeSocket = window.WebSocket;
      // Record actual native sockets so the proof can interrupt a real connection.
      // No ticket, frame, server response or browser transport is replaced.
      window.WebSocket = class extends NativeSocket {
        constructor(endpoint: string | URL, protocols?: string | string[]) {
          super(endpoint, protocols);
          sockets.push(this);
          this.addEventListener('close', (event) =>
            closeCodes.push(event.code),
          );
        }
      };
      const store = create(url);
      const frames: ServerMessage[] = [];
      const transportFrames: ServerMessage[] = [];
      store.onMessage((frame) => transportFrames.push(frame));
      const release = store.subscribeTopic(topic, (frame) => {
        frames.push(frame);
      });
      window.realtimeProof = {
        store,
        frames,
        release,
        sockets,
        closeCodes,
        transportFrames,
      };
      store.connect();
    },
    {
      topic,
      url: `wss://localhost:${resolveE2EPorts(process.env).realtime}/ws`,
    },
  );
}
