'use client';
import '../../lib/zod-jitless';
import { systemClock } from '@daisy/clock';
import { floorPagedHistory, type FloorOlderPages } from './paged-history';
import { useCallback, useEffect, useRef, useState } from 'react';
import { idSchema } from '@daisy/protocol';
import { channelMessages } from '../../features/messaging/channel-messages';
import { useRealtime } from '../../features/realtime/use-realtime';
import {
  parseFloorDiscovery,
  parseFloorMetadata,
  readFloorResponse,
  type FloorMetadata,
} from '../../features/messaging/round-floor/view';
import {
  floorUnread,
  mergeFloorMessages,
} from '../../features/messaging/round-floor/history';
import type { FloorFormState } from '../../features/messaging/round-floor/form';

export type FloorChatProps = {
  readonly roundId: string;
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly requestId: string;
  readonly readOnlyHint: boolean;
  readonly sendAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
  readonly mutateAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
  readonly reportAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
};
type Page = NonNullable<Awaited<ReturnType<typeof readFloorResponse>>>;
type FloorState =
  | { readonly kind: 'idle' | 'loading' | 'empty' | 'unavailable' | 'denied' }
  | { readonly kind: 'ready'; readonly metadata: FloorMetadata };

/** One durable floor thread; its forms stay mounted while access or the selected tab changes. */
export function useFloorChat({
  active = true,
  onUnread,
  ...props
}: FloorChatProps & {
  readonly active?: boolean;
  readonly onUnread?: ((count: number) => void) | undefined;
}) {
  const [state, setState] = useState<FloorState>({ kind: 'idle' });
  const [page, setPage] = useState<Page | null>(null);
  const [older, setOlder] = useState<FloorOlderPages | null>(null);
  const [paging, setPaging] = useState(false);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [readSequence, setReadSequence] = useState(0);
  const channelId =
    state.kind === 'ready'
      ? state.metadata.channelId
      : page?.metadata.channelId;
  const live = useRealtime(
    channelMessages(channelId ?? props.roundId),
    page?.history ?? null,
    channelId ? props.socketUrl : null,
  );
  const hidden = live.status === 'hidden' || state.kind !== 'ready';
  const generation = useRef(0);
  /** Each kind's reads, numbered as asked, and the newest one that was applied. */
  const asked = useRef({ latest: 0, older: 0 });
  const applied = useRef({ latest: 0, older: 0 });
  const busy = useRef(false);
  const base = idSchema.safeParse(props.roundId).success
    ? `/api/rounds/${props.roundId}/floor`
    : null;
  const loadHistory = useCallback(
    async (id: string, cursor?: number) => {
      if (!base || !idSchema.safeParse(id).success) return;
      const revision = generation.current;
      const kind = cursor === undefined ? 'latest' : 'older';
      const request = (asked.current[kind] += 1);
      // An answer counts while the floor is still shown and no later read of its
      // kind has been applied. A read still in flight does not supersede it, so
      // steady traffic never leaves every answer dropped.
      const current = () => {
        if (generation.current !== revision) return false;
        if (request < applied.current[kind]) return false;
        applied.current[kind] = request;
        return true;
      };
      if (kind === 'older') setPaging(true);
      try {
        const response = await fetch(
          `${base}/messages?channelId=${id}${cursor === undefined ? '' : `&before=${cursor}`}`,
          { cache: 'no-store' },
        );
        const value = await readFloorResponse(response, props.roundId, id);
        if (!current()) return;
        if (!value) {
          setNotice(
            response.status === 403 || response.status === 404
              ? 'This Round chat is unavailable.'
              : 'Messages could not be loaded. Try again.',
          );
          if (response.status === 403 || response.status === 404) {
            setState({ kind: 'denied' });
            setOlder(null);
          }
          return;
        }
        setReadSequence((sequence) =>
          Math.max(sequence, value.viewer.readSequence),
        );
        if (cursor === undefined) {
          // What the floor is now comes from the newest read of its latest page
          // alone: an older page adds messages, and may answer after it.
          setState({ kind: 'ready', metadata: value.metadata });
          setPage((previous) =>
            previous &&
            previous.history.changeVersion > value.history.changeVersion
              ? { ...value, history: previous.history }
              : value,
          );
        } else {
          setOlder((previous) => ({
            changeVersion: value.history.changeVersion,
            messages: mergeFloorMessages(
              id,
              previous?.changeVersion === value.history.changeVersion
                ? previous.messages
                : [],
              value.history.messages,
            ),
            before: value.history.nextBefore?.sequence ?? null,
          }));
          setPage((previous) =>
            previous
              ? {
                  ...previous,
                  authors: [...previous.authors, ...value.authors],
                }
              : value,
          );
        }
        setNotice(null);
      } catch {
        if (current()) setNotice('Messages could not be loaded. Try again.');
      } finally {
        // Only the older page that set it clears it: another read is not its answer.
        if (kind === 'older' && asked.current.older === request)
          setPaging(false);
      }
    },
    [
      base,
      props.roundId,
      setPaging,
      setNotice,
      setState,
      setOlder,
      setPage,
      setReadSequence,
    ],
  );
  const enter = useCallback(async () => {
    if (busy.current || !base) return;
    busy.current = true;
    setState({ kind: 'loading' });
    try {
      const response = await fetch(base, { cache: 'no-store' });
      const discovered = response.ok
        ? parseFloorDiscovery(await response.json(), props.roundId)
        : null;
      if (!discovered) {
        setState({
          kind:
            response.status === 403 || response.status === 404
              ? 'denied'
              : 'unavailable',
        });
        return;
      }
      let metadata = discovered.channel;
      if (!metadata && !props.readOnlyHint) {
        const opened = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: 1, roundId: props.roundId }),
        });
        metadata = opened.ok
          ? parseFloorMetadata(await opened.json(), props.roundId)
          : null;
        if (!metadata) {
          setState({ kind: opened.status === 403 ? 'denied' : 'unavailable' });
          return;
        }
      }
      if (!metadata) {
        setState({ kind: 'empty' });
        return;
      }
      setState({ kind: 'ready', metadata });
      await loadHistory(metadata.channelId);
    } catch {
      setState({ kind: 'unavailable' });
    } finally {
      busy.current = false;
    }
  }, [base, props.roundId, props.readOnlyHint, loadHistory, setState]);
  useEffect(() => {
    if (!active || state.kind !== 'idle') return;
    const timer = setTimeout(() => void enter(), 0);
    return () => clearTimeout(timer);
  }, [active, state.kind, enter]);
  useEffect(() => {
    if (live.status !== 'hidden') return;
    generation.current += 1;
    const timer = setTimeout(() => {
      setOlder(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [live.status]);
  const history = hidden ? null : live.body;
  const { messages, before } = history
    ? floorPagedHistory(history, older)
    : { messages: [], before: null };
  const unread = floorUnread(messages, readSequence, props.actorId);
  useEffect(() => {
    onUnread?.(unread);
  }, [onUnread, unread]);
  const latestSequence = history?.messages[0]?.sequence ?? 0;
  useEffect(() => {
    if (
      !active ||
      hidden ||
      !channelId ||
      !base ||
      latestSequence <= readSequence
    )
      return;
    let cancelled = false;
    const mark = async () => {
      try {
        const response = await fetch(`${base}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            version: 1,
            channelId,
            cursor: { channelId, sequence: latestSequence },
          }),
        });
        const value: unknown = response.ok ? await response.json() : null;
        const result = value as {
          version?: unknown;
          channelId?: unknown;
          sequence?: unknown;
        } | null;
        if (
          !cancelled &&
          result?.version === 1 &&
          result.channelId === channelId &&
          typeof result.sequence === 'number' &&
          Number.isSafeInteger(result.sequence) &&
          result.sequence >= 0 &&
          result.sequence <= latestSequence
        )
          setReadSequence((current) =>
            Math.max(current, result.sequence as number),
          );
      } catch {
        /* A failed read marker never claims the messages were read. */
      }
    };
    void mark();
    return () => {
      cancelled = true;
    };
  }, [active, hidden, channelId, base, latestSequence, readSequence]);
  const unknownAuthor = history?.messages.some(
    (message) =>
      !('unavailable' in message) &&
      !page?.authors.some((author) => author.actorId === message.authorActorId),
  );
  useEffect(() => {
    if (!unknownAuthor || !channelId || hidden) return;
    const timer = setTimeout(() => void loadHistory(channelId), 0);
    return () => clearTimeout(timer);
  }, [unknownAuthor, channelId, hidden, history?.changeVersion, loadHistory]);
  const refresh = useCallback(() => {
    if (channelId) void loadHistory(channelId);
  }, [channelId, loadHistory]);
  const expiresAt = state.kind === 'ready' ? state.metadata.expiresAt : null;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining =
        expiresAt === null
          ? null
          : Date.parse(expiresAt) - Date.parse(systemClock.now());
      setExpired(remaining !== null && remaining <= 0);
      if (remaining !== null && remaining > 0)
        timer = setTimeout(check, Math.min(remaining, 2147483647));
    };
    timer = setTimeout(check, 0);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const locked =
    hidden ||
    props.readOnlyHint ||
    state.kind !== 'ready' ||
    state.metadata.readOnly ||
    expired;
  const [initial] = useState(() => ({ text: '', requestId: props.requestId }));
  const pending =
    state.kind === 'idle' ||
    state.kind === 'loading' ||
    (state.kind === 'ready' && !history && !notice && !hidden);
  return {
    state,
    page,
    before,
    paging,
    notice,
    channelId,
    live,
    hidden,
    history,
    messages,
    expired,
    locked,
    initial,
    pending,
    enter,
    loadHistory,
    refresh,
  };
}
