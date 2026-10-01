'use client';

import {
  PageFrame,
  PageHeader,
} from '../../../ui/tournaments/page-frame/page-frame';
import { LoadFailed } from '../../../ui/tournaments/index/list-states/list-states';

/** The Tournaments segment could not render; retry re-runs it. */
export default function TournamentsError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <PageFrame>
      <PageHeader title="Tournaments" />
      <section
        aria-label="Tournaments"
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
      >
        <LoadFailed retry={reset} />
      </section>
    </PageFrame>
  );
}
