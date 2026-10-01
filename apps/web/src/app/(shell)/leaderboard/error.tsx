'use client';

import { LadderError } from '../../../ui/leaderboard/ladder-states/ladder-states';

/** The ladder could not be read: plain words and a retry, nothing internal. */
export default function LeaderboardError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 max-compact:px-4">
      <LadderError retryHref="/leaderboard" onRetry={retry} />
    </div>
  );
}
