import { Announcement } from '../../components/announcement/announcement';
import { Button } from '../../components/button/button';
import { isRoundOver } from '@daisy/protocol/round';
import { HiddenFields } from '../../form-action/hidden-fields';
import { createAppError } from '@daisy/errors';
import type { RoundBallotRead } from '@daisy/protocol/round-ballot-read';
import type { FormFields } from '../../../features/forms/form-state';
import type { BallotDisplay } from '../../../features/round-ballots/presentation';
import type { BallotPlan } from '../../../features/judge/ballot-plan';
import { BallotFields } from './ballot-form';
export const roundBallotErrorId = 'round-ballot-refusal';
type EntryProps = {
  readonly display: BallotDisplay;
  readonly view: RoundBallotRead;
  /** What the answer leaves to render: its values and the message beside them. */
  readonly answer: FormFields;
  /** Remounts the fields when what they render from is replaced. */
  readonly fieldsRevision: string;
  /** What the fields render from: the refused answer, a restored draft, or nothing. */
  readonly fieldValues: Readonly<Record<string, string>>;
  /** Called with the form after each edit, to keep the draft. */
  readonly onFieldsChange: (form: HTMLFormElement) => void;
  readonly post: (form: FormData) => void;
  readonly pending: boolean;
  readonly commandId: string;
  readonly plan: BallotPlan;
  /** How long until submitting can succeed; null when nothing is left to wait for. */
  readonly opensInMs: number | null;
};
export function BallotEntry(props: EntryProps) {
  switch (props.display) {
    case 'retry':
      return (
        <RetryBallot
          ended={isRoundOver(props.view.round.status)}
          answer={props.answer}
          post={props.post}
          pending={props.pending}
        />
      );
    case 'recorded':
      return (
        <Announcement as="p" kind="progress">
          Ballot submitted.{' '}
          {props.view.round.status === 'completed'
            ? 'The round is over and its result is recorded. Both debaters now see your decision and reason, and each sees their own feedback.'
            : 'The result is recorded once any other ballots and attendance for the last speeches settle.'}
        </Announcement>
      );
    case 'open':
      return <OpenBallot {...props} />;
    case 'waiting':
      return (
        <Announcement as="p" kind="progress">
          Your ballot opens when the recorded transcript is frozen.
        </Announcement>
      );
    case 'decided':
      return (
        <Announcement as="p" kind="progress">
          This Round is already decided. No ballot is due.
        </Announcement>
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
      <Announcement as="p" id={roundBallotErrorId} tabIndex={-1} kind="problem">
        {answer.error}
      </Announcement>
      <HiddenFields
        entries={Object.entries(answer.values).filter(
          ([name]) => !name.startsWith('$ACTION_'),
        )}
      />
      <Button variant="primary" type="submit" disabled={pending}>
        {pending ? 'Retrying…' : 'Retry original ballot'}
      </Button>
    </form>
  );
}
function OpenBallot({
  view,
  commandId,
  post,
  pending,
  plan,
  answer,
  fieldsRevision,
  fieldValues,
  onFieldsChange,
  opensInMs,
}: EntryProps) {
  if (!view.own || !view.freeze) throw createAppError('INVARIANT');
  return (
    <form
      action={post}
      aria-label="Your ballot"
      aria-busy={pending}
      onChange={(event) => onFieldsChange(event.currentTarget)}
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
          plan={plan}
          values={fieldValues}
          error={answer.error}
          errorId={roundBallotErrorId}
          pending={pending}
          opensInMs={opensInMs}
        />
      </fieldset>
    </form>
  );
}
