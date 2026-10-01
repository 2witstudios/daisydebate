import type { Advance } from '../../../features/ranked/match-flow';

/**
 * Moves the page on after a delay by a plain refresh header, so the mock
 * flow runs with no script. The real flow moves on server events instead and
 * this component goes away with the mock.
 */
export function AutoAdvance({ advance }: { readonly advance: Advance }) {
  return (
    <meta
      httpEquiv="refresh"
      content={`${advance.afterSeconds};url=${advance.href}`}
    />
  );
}
