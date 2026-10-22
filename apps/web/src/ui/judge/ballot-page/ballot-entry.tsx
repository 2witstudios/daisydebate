import { HiddenFields } from '../../form-action/hidden-fields';
import { createAppError } from '@daisy/errors';
import type { RoundBallotRead } from '@daisy/protocol';
import type { RoundBallotFormState } from '../../../features/round-ballots/form';
import type { BallotDisplay } from '../../../features/round-ballots/presentation';
import type { BallotDebaters } from '../../../features/judge/ballot';
import { buttonClass } from '../../components/button/button-class';
import { BallotFields } from './ballot-form';
export const roundBallotErrorId = 'round-ballot-refusal';
type EntryProps = {
  readonly display: BallotDisplay;
  readonly view: RoundBallotRead;
  readonly answer: RoundBallotFormState;
  readonly fieldsRevision: number;
  readonly post: (form: FormData) => void;
  readonly pending: boolean;
  readonly commandId: string;
  readonly debaters: BallotDebaters;
};
export function BallotEntry(props: EntryProps) {
  switch (props.display) {
    case 'retry':
      return (
        <RetryBallot
          ended={
            props.view.round.status === 'completed' ||
            props.view.round.status === 'abandoned'
          }
          answer={props.answer}
          post={props.post}
          pending={props.pending}
        />
      );
    case 'recorded':
      return (
        <p role="status">
          Ballot submitted.{' '}
          {props.view.round.status === 'completed'
            ? 'The Round result is recorded.'
            : 'Other votes or attendance settlement are still pending.'}
        </p>
      );
    case 'voided':
      return (
        <p role="status">
          This ballot is voided. A replacement cannot be submitted.
        </p>
      );
    case 'open':
      return <OpenBallot {...props} />;
    case 'waiting':
      return (
        <p role="status">
          Your ballot opens when the recorded transcript is frozen.
        </p>
      );
    case 'decided':
      return (
        <p role="status">This Round is already decided. No ballot is due.</p>
      );
  }
}
function RetryBallot({
  ended,
  answer,
  post,
  pending,
}: Pick<EntryProps, 'answer' | 'post' | 'pending'> & {
  readonly ended: boolean;
}) {
  return (
    <form
      action={post}
      aria-label="Retry unacknowledged ballot"
      aria-busy={pending}
    >
      {ended ? (
        <p>
          This Round has ended. Your original submission can still be retried.
        </p>
      ) : null}
      <p id={roundBallotErrorId} tabIndex={-1} role="alert">
        {answer.error}
      </p>
      <HiddenFields
        entries={Object.entries(answer.values).filter(
          ([name]) => !name.startsWith('$ACTION_'),
        )}
      />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass('primary')}
      >
        {pending ? 'Retrying…' : 'Retry original ballot'}
      </button>
    </form>
  );
}
function OpenBallot({
  view,
  commandId,
  post,
  pending,
  debaters,
  answer,
  fieldsRevision,
}: EntryProps) {
  if (!view.own || !view.freeze) throw createAppError('INVARIANT');
  return (
    <form
      action={post}
      aria-label="Your ballot"
      aria-busy={pending}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="version" value="1" />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="expectedVersion" value={view.round.version} />
      <input
        type="hidden"
        name="judgeParticipantId"
        value={view.own.participantId}
      />
      <input type="hidden" name="freezeRevision" value={view.freeze.revision} />
      <fieldset disabled={pending} className="contents">
        <BallotFields
          key={fieldsRevision}
          debaters={debaters}
          values={answer.values}
          error={answer.error}
          errorId={roundBallotErrorId}
          pending={pending}
        />
      </fieldset>
    </form>
  );
}
