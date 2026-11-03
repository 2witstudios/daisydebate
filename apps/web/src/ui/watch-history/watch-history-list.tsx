'use client';
import Link from 'next/link';
import { ActionForm, type FormStateAction } from '../form-action/action-form';
import { Button } from '../components/button/button';

export type WatchHistoryEntry = {
  readonly roundId: string;
  /** Null until the timeline has released it. */
  readonly resolution: string | null;
  readonly watchedAt: string;
  readonly forget: FormStateAction;
};

/** What you have watched, kept for a year. Only you can see it, and you can clear it. */
export function WatchHistoryList({
  entries,
  clear,
}: {
  readonly entries: readonly WatchHistoryEntry[];
  readonly clear: FormStateAction;
}) {
  if (entries.length === 0)
    return (
      <p className="text-base text-ink-muted">You have not watched a Round.</p>
    );
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.roundId}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <Link href={`/watch/${entry.roundId}`} className="text-base">
              {entry.resolution ?? 'A Round on air'}
            </Link>
            <ActionForm action={entry.forget} label="Remove from history">
              {({ pending }) => (
                <Button type="submit" variant="secondary" disabled={pending}>
                  Remove
                </Button>
              )}
            </ActionForm>
          </li>
        ))}
      </ul>
      <ActionForm action={clear} label="Clear watch history">
        {({ error, pending }) => (
          <>
            <Button type="submit" variant="secondary" disabled={pending}>
              Clear history
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-live">
                {error}
              </p>
            ) : null}
          </>
        )}
      </ActionForm>
    </div>
  );
}
