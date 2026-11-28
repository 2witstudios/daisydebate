'use client';
import { useNavigation } from '../edge/use-navigation';
import { Button } from '../components/button/button';
import { useId, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isLiveDebater } from './live-round';
import { UnacknowledgedCommand } from './unacknowledged-command';
import type { RoundView } from '@daisy/protocol/round-view';
import {
  controlKeyOf,
  roundControlIntents,
  type RoundControlIntent,
} from '../../features/round-runtime/control-intents';
import {
  roundCommandUnavailable,
  roundFormFields,
  type RoundFormState,
} from '../../features/round-runtime/command-form';
import { idle } from '../../features/forms/form-state';
import type { RoundCommandIds } from '../../features/round-runtime/command-ids';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { FormError } from '../components/form-field/form-field';
import { browserDocument } from '../round-media/browser-document';
import { replaceRoute } from '../round-media/replace-route';
const unanswered: RoundFormState = idle();
export function CommandForm({
  intent,
  commandId,
  version,
  segment,
  post,
  answer,
  pending,
  control,
}: {
  readonly intent: RoundControlIntent;
  readonly commandId: string;
  readonly version: number;
  /** The persisted open segment this control acts on ('' between segments). */
  readonly segment: string;
  readonly post: (form: FormData) => void;
  readonly answer: RoundFormState;
  readonly pending: boolean;
  readonly control: string;
}) {
  // A confirmation belongs to the segment it was asked in: once another
  // segment opens, the press starts afresh rather than end the new one.
  const { values } = roundFormFields(answer);
  const confirming = answer.kind === 'confirming';
  const asked =
    controlKeyOf(values.type, values.offererParticipantId) === intent.key &&
    (!confirming || values.segment === segment);
  const { command } = intent;
  const preserved = asked ? values : {};
  const confirmation = confirming && asked;
  return (
    <form action={post} aria-busy={pending} className="flex flex-col gap-1">
      <input type="hidden" name="version" value="1" />
      <input
        type="hidden"
        name="commandId"
        value={preserved.commandId ?? commandId}
      />
      {/* A confirmation confirms the round the debater sees now; only an
          unacknowledged attempt replays its original version (ISSUE-838). */}
      <input
        type="hidden"
        name="expectedVersion"
        value={confirmation ? version : (preserved.expectedVersion ?? version)}
      />
      <input type="hidden" name="type" value={intent.type} />
      <input type="hidden" name="segment" value={segment} />
      {'sequence' in command ? (
        <input type="hidden" name="sequence" value={command.sequence} />
      ) : null}
      {command.type === 'accept_poi' ? (
        <input
          type="hidden"
          name="offererParticipantId"
          value={command.offererParticipantId}
        />
      ) : null}
      {intent.participantId ? (
        <input
          type="hidden"
          name="participantId"
          value={intent.participantId}
        />
      ) : null}
      {confirmation || preserved.confirmed === 'true' ? (
        <input type="hidden" name="confirmed" value="true" />
      ) : null}
      <Button
        variant={
          intent.emphasis === 'point'
            ? 'point'
            : intent.emphasis === 'primary' || confirmation
              ? 'primary'
              : 'secondary'
        }
        size="room"
        id={`${control}-${intent.key}`}
        type="submit"
        disabled={pending || !intent.enabled}
        aria-describedby={
          intent.hint ? `${control}-${intent.key}-hint` : undefined
        }
      >
        {confirmation ? `Confirm ${intent.label.toLowerCase()}` : intent.label}
      </Button>
      {intent.hint ? (
        <span
          id={`${control}-${intent.key}-hint`}
          className="text-xs text-ink-muted tabular-nums"
        >
          {intent.hint}
        </span>
      ) : null}
    </form>
  );
}
/** A refused strike means nothing once the strike is over; other answers stay. */
export const shownError = (
  answer: RoundFormState,
  view: Pick<RoundView, 'opening'>,
) =>
  answer.kind === 'refused' &&
  answer.values.type === 'strike_resolution' &&
  view.opening?.step.step !== 'strike'
    ? undefined
    : roundFormFields(answer).error;

/** The result link that takes the commands' place on a post-round call. */
export const CALL_RESULT_LINK_ID = 'round-call-result';

/**
 * Where focus goes after an answer: what the answer shows, else its control.
 * On a post-round call the controls are gone, so it goes to what replaced them.
 */
export const answerFocusTarget = (
  answer: RoundFormState,
  view: Pick<RoundView, 'opening'>,
  feedback: string,
  control: string,
  onCall = false,
) => {
  if (shownError(answer, view)) return feedback;
  const { values } = roundFormFields(answer);
  return onCall
    ? CALL_RESULT_LINK_ID
    : `${control}-${controlKeyOf(values.type, values.offererParticipantId)}`;
};

/** Feedback survives a canonical revision that removes the submitted action. */
export function RoundCommandActions({
  view,
  actorId,
  nowMs,
  onCall = false,
  ids,
  action,
  onAnswer,
  children,
}: {
  /** The command forms, any answer about them for the frame to show, and the form the opening's strike posts through. */
  readonly children: (
    actions: ReactNode,
    feedback: ReactNode,
    form: {
      readonly post: (form: FormData) => void;
      readonly pending: boolean;
    },
  ) => ReactNode;
  readonly view: RoundView;
  readonly actorId: string;
  readonly nowMs: number;
  /** This debater is on the Round's post-round call, so the room stays. */
  readonly onCall?: boolean;
  readonly ids: RoundCommandIds;
  readonly action: FormAction<RoundFormState>;
  readonly onAnswer: (answer: RoundFormState) => void;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    unanswered,
    roundCommandUnavailable,
    onAnswer,
  );
  const router = useRouter();
  const lost = answer.kind === 'unacknowledged';
  // A debater on the post-round call stays in the room until it ends (ADR 0127).
  const leaving = !pending && !lost && !isLiveDebater(view, actorId) && !onCall;
  useNavigation(
    router,
    leaving ? `/rounds/${view.id}` : undefined,
    (to, href) => replaceRoute(to, browserDocument(), href),
  );
  const feedback = useId(),
    control = useId();
  // The feedback moves when the Round ends and the frame gives way, so an answer
  // on screen is focused again in its new place.
  const live = isLiveDebater(view, actorId);
  const answered = useMemo(() => ({ answer, live }), [answer, live]);
  useFocusAfterAnswer(
    answered,
    answerFocusTarget(answer, view, feedback, control, onCall),
    !pending,
  );
  const actions = !lost ? (
    <>
      {roundControlIntents(view, actorId, nowMs).map((intent) => (
        <CommandForm
          key={intent.key}
          intent={intent}
          commandId={ids[intent.type]}
          version={view.version}
          segment={String(
            view.segments.find((s) => s.endedAt === null)?.sequence ?? '',
          )}
          post={post}
          answer={answer}
          pending={pending}
          control={control}
        />
      ))}
    </>
  ) : (
    <></>
  );
  return children(
    actions,
    <>
      <div id={feedback} tabIndex={-1}>
        <FormError error={shownError(answer, view)} />
      </div>
      <UnacknowledgedCommand answer={answer} post={post} pending={pending} />
    </>,
    { post, pending },
  );
}
