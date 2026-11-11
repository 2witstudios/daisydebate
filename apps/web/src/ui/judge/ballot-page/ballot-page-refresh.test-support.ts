import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement, type ComponentProps } from 'react';
import { BallotPage } from './ballot-page';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

/** The ballot page under a router that only counts the refreshes asked of it. */
export function RoutedBallotPage({
  onRefresh,
  ...page
}: ComponentProps<typeof BallotPage> & { readonly onRefresh: () => void }) {
  return createElement(
    AppRouterContext.Provider,
    {
      value: { refresh: onRefresh } as unknown as ComponentProps<
        typeof AppRouterContext.Provider
      >['value'],
    },
    createElement(BallotPage, page),
  );
}
