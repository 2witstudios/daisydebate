'use client';
import { PublishedAudience, usePublishedState } from './published-state';

/** Polls for an audience shown with no player beside it. */
export function PublishedAudienceFeed({
  stateUrl,
  children,
}: {
  readonly stateUrl: string | null;
  readonly children: React.ReactNode;
}) {
  const { state } = usePublishedState(stateUrl, () => true);
  return (
    <PublishedAudience.Provider value={state}>
      {children}
    </PublishedAudience.Provider>
  );
}
