'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  completionOwnership,
  initialCompletionOwnership,
} from './completion-ownership';
import {
  messageFormUnavailable,
  type MessageFormState,
} from '../../features/messaging/forms/send-form';
import {
  answerUnavailableOnThrow,
  type FormAction,
} from '../form-action/form-action';
import { browserDocument } from '../round-media/browser-document';
import { replaceRoute } from '../round-media/replace-route';

function createScope(requestId: string, changed: () => void) {
  let state = initialCompletionOwnership(requestId);
  const accept = (event: Parameters<typeof completionOwnership>[1]) => {
    const result = completionOwnership(state, event);
    if (state !== result.state) {
      state = result.state;
      changed();
    }
    return result.apply;
  };
  return { snapshot: () => state, accept };
}
type Scope = ReturnType<typeof createScope>;

function createLifetime(requestId: string) {
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  let scope = createScope(requestId, changed);
  return {
    current: () => scope,
    snapshot: () => scope.snapshot(),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount: () => {
      // Effect replay starts a new lifetime, never revives the disposed origin.
      if (scope.snapshot().disposed) {
        scope = createScope(scope.snapshot().offeredId, changed);
        changed();
      }
      const mounted = scope;
      return () => {
        mounted.accept({ type: 'dispose' });
      };
    },
  };
}
const Navigation = createContext<ReturnType<typeof createLifetime> | null>(
  null,
);

/** One conversation owns both its command lifecycle and navigation authority. */
export function ConversationNavigation({
  children,
  requestId,
}: {
  readonly children: ReactNode;
  readonly requestId: string;
}) {
  const [holder] = useState(() => createLifetime(requestId));
  useEffect(() => holder.mount(), [holder]);
  useEffect(() => {
    holder.current().accept({ type: 'rendered', requestId });
  }, [holder, requestId]);
  return <Navigation value={holder}>{children}</Navigation>;
}

export function ConversationLink(
  props: Omit<ComponentProps<typeof Link>, 'onNavigate'>,
) {
  const navigation = useContext(Navigation);
  return (
    <Link
      {...props}
      onNavigate={() => navigation?.current().accept({ type: 'navigate' })}
    />
  );
}

/** Check cancellation after propagation, before a document can commit. */
export function ConversationSearchForm(
  props: Omit<ComponentProps<'form'>, 'onSubmit'>,
) {
  const navigation = useContext(Navigation);
  return (
    <form
      {...props}
      onSubmit={(event) => {
        const submitted = event.nativeEvent;
        const scope = navigation?.current();
        queueMicrotask(() => {
          if (!submitted.defaultPrevented) scope?.accept({ type: 'navigate' });
        });
      }}
    />
  );
}

function useNavigation() {
  const navigation = useContext(Navigation);
  if (navigation === null)
    throw new Error('A message composer requires its conversation owner');
  return navigation;
}

export function useConversationCommand() {
  const owner = useNavigation();
  return useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot)
    .command.id;
}

type Origin = { readonly scope: Scope; readonly id: number };
type CompletionAnswer = MessageFormState & {
  readonly completion?: Origin | null;
};
const serverState = ({
  completion: _completion,
  ...state
}: CompletionAnswer): MessageFormState => state;

/** The server keeps the actual action identity; only the browser stamps its answer. */
export function useConversationAction(
  action: FormAction<MessageFormState>,
  requestId: string,
): FormAction<CompletionAnswer> {
  const navigation = useNavigation();
  const latest = useRef<Origin | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const captured = latest.current;
      if (captured !== null)
        captured.scope.accept({ type: 'abandon', origin: captured.id });
      latest.current = null;
    };
  }, []);
  if (typeof window === 'undefined') return action;
  return async (state, form) => {
    const scope = navigation.current();
    let completion: Origin | null = null;
    if (
      mounted.current &&
      scope.snapshot().command.id === requestId &&
      !scope.snapshot().disposed
    ) {
      // Actual dispatch, synchronously before invoking/awaiting the server action.
      scope.accept({ type: 'dispatch' });
      completion = { scope, id: scope.snapshot().sequence };
      latest.current = completion;
    }
    const answer = await answerUnavailableOnThrow(
      action,
      messageFormUnavailable,
    )(serverState(state), form);
    return { ...answer, completion };
  };
}

/** An answer carries its own dispatch origin, never the newest form's origin. */
export function useConversationCompletion(
  answer: CompletionAnswer,
  pending: boolean,
) {
  const router = useRouter();
  const seen = useRef(answer);
  useEffect(() => {
    if (pending || seen.current === answer) return;
    seen.current = answer;
    const captured = answer.completion;
    if (captured == null) return;
    const apply = captured.scope.accept({
      type: answer.next === undefined ? 'failed' : 'complete',
      origin: captured.id,
    });
    if (apply && answer.next !== undefined)
      replaceRoute(router, browserDocument(), answer.next);
  }, [answer, pending, router]);
}
