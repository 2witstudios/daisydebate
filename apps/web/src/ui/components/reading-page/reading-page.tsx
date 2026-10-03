import type { ReactNode } from 'react';

/**
 * The frame of a page that is mostly text: a reading-width column centred in
 * the content area with the shell's usual padding, so it never hugs the edge
 * of a wide screen.
 */
export function ReadingPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      {children}
    </div>
  );
}
