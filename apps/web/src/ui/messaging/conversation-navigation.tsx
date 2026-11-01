'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  completionOwnership,
  initialCompletionOwnership,
} from './completion-ownership';
import { browserDocument } from '../round-media/browser-document';
import { replaceRoute } from '../round-media/replace-route';

function createScope() {
  let state = initialCompletionOwnership();
  const accept = (event: Parameters<typeof completionOwnership>[1]) => {
    const result = completionOwnership(state, event);
    state = result.state;
    return result.apply;
  };
  return {
    disposed: () => state.disposed,
    dispatch: () => {
      accept({ type: 'dispatch' });
      return state.sequence;
    },
    navigate: () => {
      accept({ type: 'navigate' });
    },
    consume: (origin: number) => accept({ type: 'complete', origin }),
    dispose: () => {
      accept({ type: 'dispose' });
    },
  };
}

type Scope = ReturnType<typeof createScope>;
function createLifetime() {
  let scope = createScope();
  return {
    current: () => scope,
    mount: () => {
      // Effect replay starts a new lifetime, never revives the disposed origin.
      if (scope.disposed()) scope = createScope();
      const mounted = scope;
      return () => mounted.dispose();
    },
  };
}
const Navigation = createContext<ReturnType<typeof createLifetime> | null>(
  null,
);

/** One mounted conversation lifetime; never shared with another route or tab. */
export function ConversationNavigation({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [holder] = useState(createLifetime);
  useEffect(() => holder.mount(), [holder]);
  return <Navigation value={holder}>{children}</Navigation>;
}

export function ConversationLink(
  props: Omit<ComponentProps<typeof Link>, 'onNavigate'>,
) {
  const navigation = useContext(Navigation);
  return (
    <Link {...props} onNavigate={() => navigation?.current().navigate()} />
  );
}

/** Browser constraint validation precedes submit; canceled events keep ownership. */
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
        // Observe cancellation after propagation, before a document can commit.
        queueMicrotask(() => {
          if (!submitted.defaultPrevented) scope?.navigate();
        });
      }}
    />
  );
}

/** Capture at the form's dispatch edge; keep its native server action intact. */
export function useConversationCompletion(next: string | undefined) {
  const navigation = useContext(Navigation);
  const router = useRouter();
  const origin = useRef<{ readonly scope: Scope; readonly id: number } | null>(
    null,
  );
  useEffect(
    () => () => {
      const captured = origin.current;
      if (captured !== null) captured.scope.consume(captured.id);
      origin.current = null;
    },
    [],
  );
  useEffect(() => {
    const captured = origin.current;
    if (
      next !== undefined &&
      captured !== null &&
      captured.scope.consume(captured.id)
    ) {
      replaceRoute(router, browserDocument(), next);
    }
  }, [next, router]);
  return () => {
    if (navigation === null) return;
    const scope = navigation.current();
    origin.current = { scope, id: scope.dispatch() };
  };
}
