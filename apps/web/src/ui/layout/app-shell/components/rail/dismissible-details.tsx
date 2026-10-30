'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../../../cn';

/**
 * A native disclosure that also closes when the pointer lands outside it or
 * Escape is pressed. The `<details>`/`<summary>` stay in the server-rendered
 * markup, so the disclosure still opens without JavaScript; this component only
 * adds the dismiss-on-outside-click enhancement once hydrated.
 */
export function DismissibleDetails({
  className,
  summaryClassName,
  summaryAriaLabel,
  summaryTitle,
  summary,
  children,
}: {
  readonly className?: string;
  readonly summaryClassName?: string;
  readonly summaryAriaLabel?: string;
  readonly summaryTitle?: string;
  readonly summary: ReactNode;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onDocumentClick = (event: MouseEvent) => {
      if (!element.open) return;
      const target = event.target as Node | null;
      if (target && element.contains(target)) return;
      element.open = false;
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !element.open) return;
      // Return focus to the disclosure control only when focus was inside it,
      // so an Escape pressed elsewhere on the page never steals focus.
      const active = document.activeElement;
      if (active && active !== summaryRef.current && element.contains(active)) {
        summaryRef.current?.focus();
      }
      element.open = false;
    };

    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeydown);
    };
  }, []);

  return (
    <details ref={ref} className={cn(className)}>
      <summary
        ref={summaryRef}
        aria-label={summaryAriaLabel}
        title={summaryTitle}
        className={cn(summaryClassName)}
      >
        {summary}
      </summary>
      {children}
    </details>
  );
}
