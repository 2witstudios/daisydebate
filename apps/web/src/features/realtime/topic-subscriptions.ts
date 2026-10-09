import {
  ENVELOPE_VERSION,
  parseTopic,
  serverMessageSchema,
  type ServerMessage,
} from '@daisy/protocol';

type Listener = (frame: ServerMessage) => void;
type Entry = {
  readonly listeners: Set<Listener>;
  position?: string;
  requestId?: string;
};

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const result = serverMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Owns subscription correlation and cursors; consumers refetch authoritative HTTP views. */
export function createTopicSubscriptions({
  send,
}: {
  readonly send: (frame: object) => void;
}) {
  const topics = new Map<string, Entry>();
  const messageListeners = new Set<Listener>();
  let requestCounter = 0;
  function request(type: 'subscribe' | 'unsubscribe', topic: string) {
    const id = `rt${(++requestCounter).toString(36).padStart(22, '0')}`;
    const entry = topics.get(topic);
    if (entry) entry.requestId = id;
    send({
      v: ENVELOPE_VERSION,
      type,
      id,
      topic,
      ...(type === 'subscribe' && entry?.position
        ? { since: entry.position }
        : {}),
    });
  }
  function entryFor(frame: ServerMessage) {
    if ('topic' in frame) return topics.get(frame.topic);
    if (frame.type === 'error')
      return [...topics.values()].find((entry) => entry.requestId === frame.id);
    return undefined;
  }
  function correlated(frame: ServerMessage, entry: Entry | undefined) {
    if ('topic' in frame && !entry) return false;
    if (frame.type === 'subscribed' || frame.type === 'resync_required')
      return entry?.requestId === frame.id;
    return true;
  }
  function advance(frame: ServerMessage, entry: Entry | undefined) {
    if (!entry) return;
    if (frame.type === 'event' || frame.type === 'subscribed')
      entry.position = frame.position;
    if (frame.type === 'resync_required') delete entry.position;
  }
  function notify(listeners: Iterable<Listener>, frame: ServerMessage) {
    for (const listener of listeners) {
      try {
        listener(frame);
      } catch {
        /* Consumer failures cannot stop transport. */
      }
    }
  }
  return {
    subscribe(topic: string, listener: Listener) {
      if (!parseTopic(topic)) throw new Error('Invalid realtime topic');
      let entry = topics.get(topic);
      if (!entry) {
        entry = { listeners: new Set() };
        topics.set(topic, entry);
        request('subscribe', topic);
      }
      const registration: Listener = (frame) => listener(frame);
      entry.listeners.add(registration);
      const subscribedEntry = entry;
      return () => {
        subscribedEntry.listeners.delete(registration);
        if (
          topics.get(topic) !== subscribedEntry ||
          subscribedEntry.listeners.size !== 0
        )
          return;
        request('unsubscribe', topic);
        topics.delete(topic);
      };
    },
    onMessage(listener: Listener) {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
    resubscribe(topic: string) {
      if (topics.has(topic)) request('subscribe', topic);
    },
    reconnect() {
      for (const topic of topics.keys()) request('subscribe', topic);
    },
    clear() {
      topics.clear();
    },
    emit(frame: ServerMessage) {
      const entry = entryFor(frame);
      if (!correlated(frame, entry)) return;
      advance(frame, entry);
      notify([...messageListeners, ...(entry?.listeners ?? [])], frame);
    },
  };
}
