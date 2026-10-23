'use client';
import Link from 'next/link';
import { StoredBallotScores } from '../../ballot/stored-ballot-scores';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RoundBallotRead } from '@daisy/protocol';
import {
  ballotDebaters,
  ballotDisplay,
} from '../../../features/round-ballots/presentation';
import {
  ballotUnavailable,
  type RoundBallotFormState,
} from '../../../features/round-ballots/form';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';
import { BallotSummary } from '../../ballot/ballot-summary/ballot-summary';
import { PageHeader } from '../../components/page-header/page-header';
import { BallotEntry, roundBallotErrorId as errorId } from './ballot-entry';
import { BallotEvidence } from './ballot-evidence';
/** Mounted above every canonical state, so an unknown acknowledgement always keeps its original retry. */
export function BallotPage({
  view,
  commandId: seedId,
  action,
}: {
  readonly view: RoundBallotRead;
  readonly commandId: string;
  readonly action: FormAction<RoundBallotFormState>;
}) {
  const router = useRouter();
  const [commandId] = useState(seedId);
  const [answer, post, pending] = useFormAction<RoundBallotFormState>(
    action,
    { values: {} },
    ballotUnavailable,
  );
  const [rendered, setRendered] = useState({ answer, revision: 0 });
  // A settled refusal restores the submitted controls, including the native range inputs.
  // Keep the command/retry owner mounted while replacing only that editable field tree.
  if (rendered.answer !== answer)
    setRendered({ answer, revision: rendered.revision + 1 });
  useFocusAfterAnswer(answer, answer.error ? errorId : undefined, !pending);
  useEffect(() => {
    if (answer.receipt) router.refresh();
  }, [answer.receipt, router]);
  useEffect(() => {
    if (view.round.status !== 'active' || view.freeze || answer.unacknowledged)
      return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [view.round.status, view.freeze, answer.unacknowledged, router]);
  const debaters = ballotDebaters(view);
  const display = ballotDisplay(view, answer);
  const own = display === 'retry' ? null : view.own?.ballot;
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <Link
        href="/judge"
        className="inline-flex min-h-10 items-center text-base font-strong"
      >
        Back to Judge
      </Link>
      <PageHeader title="Your ballot" lede={view.round.topic} />
      <BallotEntry
        display={display}
        view={view}
        answer={answer}
        fieldsRevision={rendered.revision}
        post={post}
        pending={pending}
        commandId={commandId}
        debaters={debaters}
      />
      {own ? (
        <BallotSummary
          title="Your recorded ballot"
          ballot={own}
          debaters={debaters}
        />
      ) : null}
      {own ? (
        <StoredBallotScores
          title="Your recorded scores"
          ballot={own}
          debaters={debaters}
        />
      ) : null}
      {display !== 'retry' && view.round.status === 'completed' ? (
        <p role="status">
          Round outcome: {view.round.outcome ?? 'No competitive outcome'}
        </p>
      ) : null}
      <Link
        href={`/judge/ballot/${view.round.id}`}
        prefetch={false}
        onClick={(event) => {
          event.preventDefault();
          router.refresh();
        }}
        className="inline-flex min-h-10 items-center text-base font-strong"
      >
        Refresh Round
      </Link>
      <Link
        href={`/rounds/${view.round.id}`}
        className="inline-flex min-h-10 items-center text-base font-strong"
      >
        View Round
      </Link>
      <BallotEvidence view={view} />
    </div>
  );
}
