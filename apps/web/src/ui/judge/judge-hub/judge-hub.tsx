import Link from 'next/link';
import type { AssignedDebate } from '../../../features/judge/get-assigned';
import { PageHeader } from '../../components/page-header/page-header';
import { AssignedDebates } from '../assigned-debates/assigned-debates';
export type JudgeHubProps = { readonly assigned: readonly AssignedDebate[] };
/** Fresh own-seat assignments; waiting never fabricates a match or a ballot. */
export function JudgeHub({ assigned }: JudgeHubProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader title="Judge" />
      {assigned.length ? (
        <AssignedDebates debates={assigned} />
      ) : (
        <section
          aria-label="Waiting for an assignment"
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6"
        >
          <h2 className="text-lg font-strong">No assigned Rounds</h2>
          <p role="status">
            Join a Room as its judge. Your assigned Rounds and recorded ballots
            appear here.
          </p>
          <Link
            href="/lobby"
            className="inline-flex min-h-10 items-center font-strong"
          >
            Find a Room
          </Link>
        </section>
      )}
      <Link
        href="/judge"
        className="inline-flex min-h-10 items-center font-strong"
      >
        Refresh assignments
      </Link>
    </div>
  );
}
