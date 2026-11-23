'use client';

import { useDeliver } from '../edge/use-answer';
import { useResource } from '../edge/use-driver';
import { ShellLink as Link } from '../layout/app-shell/shell-link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
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
import { destinationOf } from '../../features/forms/form-state';
import {
  answerUnavailableOnThrow,
  type FormAction,
} from '../form-action/form-action';
import { followAnswer } from '../form-action/use-moved-on';
import { SearchForm } from '../components/search-form/search-form';

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
/** The conversation's mounted lifetime: disposing it disposes its scope. */
const mountLifetime = (holder: ReturnType<typeof createLifetime>) => ({
  dispose: holder.mount(),
});
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
  useResource(holder, mountLifetime);
  useDeliver(requestId, (rendered) => {
    holder.current().accept({ type: 'rendered', requestId: rendered });
  });
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

export function ConversationSearchForm(
  props: Omit<ComponentProps<typeof SearchForm>, 'onSubmit'>,
) {
  const navigation = useContext(Navigation);
  return (
    <SearchForm
      {...props}
      onSubmit={() => navigation?.current().accept({ type: 'navigate' })}
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
  const { command, generation } = useSyncExternalStore(
    owner.subscribe,
    owner.snapshot,
    owner.snapshot,
  );
  return {
    requestId: command.id,
    generation,
    restoreFocus: command.status === 'draft' && command.restoreFocus,
  };
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
): FormAction<CompletionAnswer> {
  const navigation = useNavigation();
  const latest = useRef<Origin | null>(null);
  // Leaving the form abandons the command it dispatched last.
  useResource(latest, (dispatched) => ({
    dispose: () => {
      const captured = dispatched.current;
      if (captured !== null)
        captured.scope.accept({ type: 'abandon', origin: captured.id });
      dispatched.current = null;
    },
  }));
  if (typeof window === 'undefined') return action;
  return async (state, form) => {
    const scope = navigation.current();
    // Actual dispatch, synchronously before invoking/awaiting the server action.
    scope.accept({ type: 'dispatch' });
    const completion = { scope, id: scope.snapshot().sequence };
    latest.current = completion;
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
  // Each settled answer is completed once; a pending one waits.
  useDeliver(pending ? null : answer, (settled) => {
    if (settled === null || seen.current === settled) return;
    seen.current = settled;
    const answer = settled;
    const captured = answer.completion;
    if (captured == null) return;
    const next = destinationOf(answer);
    const apply = captured.scope.accept({
      type: next === undefined ? 'failed' : 'complete',
      origin: captured.id,
    });
    if (apply && next !== undefined) followAnswer(router, next);
  });
}
