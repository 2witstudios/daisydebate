import '../../lib/zod-jitless';
import { systemClock } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import type { ChatContext } from '../../features/messaging/context-chat/chat-context';
import type { ContextChatEffect } from '../../features/messaging/context-chat/chat-effects';
import type { ContextChatEvent } from '../../features/messaging/context-chat/chat-events';
import {
  initialContextChatState,
  type ContextChatState,
} from '../../features/messaging/context-chat/chat-state';
import { reduceContextChat } from '../../features/messaging/context-chat/reduce-chat';
import {
  parseContextChatDiscovery,
  parseContextChatMetadata,
  parseContextChatReadMark,
  readContextChatResponse,
} from '../../features/messaging/context-chat/view';

type Effect<Type extends ContextChatEffect['type']> = Extract<
  ContextChatEffect,
  { readonly type: Type }
>;
const LONGEST_TIMER_MS = 2147483647;
const refusedAccess = (status: number) => status === 403 || status === 404;
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Holds one owner's chat state and does what its model asks: the reads, the marker and the expiry timer. */
export function createContextChatDriver(context: ChatContext, ownerId: string) {
  const base = idSchema.safeParse(ownerId).success
    ? context.address(ownerId)
    : null;
  const listeners = new Set<() => void>();
  let state = initialContextChatState;
  let stopped = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  const send = (event: ContextChatEvent) => {
    if (stopped || base === null) return;
    const step = reduceContextChat(state, event);
    if (step.state !== state) {
      state = step.state;
      for (const listener of listeners) listener();
    }
    for (const effect of step.effects) run(effect);
  };

  const discover = async ({ request }: Effect<'discover'>) => {
    try {
      const response = await fetch(base!, { cache: 'no-store' });
      const found = response.ok
        ? parseContextChatDiscovery(context, await response.json(), ownerId)
        : null;
      send(
        found
          ? { type: 'discovered', request, channel: found.channel }
          : {
              type: 'entry-refused',
              request,
              denied: refusedAccess(response.status),
            },
      );
    } catch {
      send({ type: 'entry-refused', request, denied: false });
    }
  };

  const open = async ({ request }: Effect<'open'>) => {
    try {
      const response = await fetch(
        base!,
        json({ version: 1, [context.ownerKey]: ownerId }),
      );
      const metadata = response.ok
        ? parseContextChatMetadata(context, await response.json(), ownerId)
        : null;
      send(
        metadata
          ? { type: 'opened', request, metadata }
          : {
              type: 'entry-refused',
              request,
              denied: response.status === 403,
            },
      );
    } catch {
      send({ type: 'entry-refused', request, denied: false });
    }
  };

  const read = async (effect: Effect<'read-latest' | 'read-older'>) => {
    const { request, channelId } = effect;
    const kind = effect.type === 'read-latest' ? 'latest' : 'older';
    try {
      const response = await fetch(
        `${base!}/messages?channelId=${channelId}${
          effect.type === 'read-older' ? `&before=${effect.before}` : ''
        }`,
        { cache: 'no-store' },
      );
      const page = await readContextChatResponse(
        context,
        response,
        ownerId,
        channelId,
      );
      send(
        page
          ? { type: `${kind}-read`, request, page }
          : {
              type: 'read-refused',
              request,
              read: kind,
              denied: refusedAccess(response.status),
            },
      );
    } catch {
      send({ type: 'read-refused', request, read: kind, denied: false });
    }
  };

  const markRead = async (effect: Effect<'mark-read'>) => {
    const { request, channelId, sequence } = effect;
    try {
      const response = await fetch(
        `${base!}/read`,
        json({ version: 1, channelId, cursor: { channelId, sequence } }),
      );
      const marked = response.ok
        ? parseContextChatReadMark(await response.json(), channelId)
        : null;
      send(
        marked === null
          ? { type: 'read-mark-failed', request }
          : { type: 'read-marked', request, sequence: marked },
      );
    } catch {
      send({ type: 'read-mark-failed', request });
    }
  };

  const watchExpiry = ({ expiresAt }: Effect<'watch-expiry'>) => {
    clearTimeout(expiry);
    if (expiresAt === null) return;
    const check = () => {
      const remaining = Date.parse(expiresAt) - Date.parse(systemClock.now());
      if (remaining <= 0) send({ type: 'expiry-reached', expiresAt });
      else expiry = setTimeout(check, Math.min(remaining, LONGEST_TIMER_MS));
    };
    expiry = setTimeout(check, 0);
  };

  function run(effect: ContextChatEffect) {
    switch (effect.type) {
      case 'discover':
        return void discover(effect);
      case 'open':
        return void open(effect);
      case 'read-latest':
      case 'read-older':
        return void read(effect);
      case 'mark-read':
        return void markRead(effect);
      case 'watch-expiry':
        return watchExpiry(effect);
    }
  }

  return {
    send,
    state: (): ContextChatState => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      stopped = false;
    },
    /** Answers still on their way change nothing once the chat has left the page. */
    stop: () => {
      stopped = true;
      clearTimeout(expiry);
    },
  };
}
