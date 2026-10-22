'use client';
import { useEffect, useId, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isLiveDebater } from './live-round';
import { UnacknowledgedCommand } from './unacknowledged-command';
import type { RoundView } from '@daisy/protocol';
import {
  roundControlIntents,
  type RoundControlIntent,
} from '../../features/round-runtime/control-intents';
import {
  roundCommandUnavailable,
  type RoundFormState,
} from '../../features/round-runtime/command-form';
import type { RoundCommandIds } from '../../features/round-runtime/command-ids';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { FormError } from '../components/form-field/form-field';
const unanswered: RoundFormState = { values: {} };
function CommandForm({
  intent,
  commandId,
  version,
  post,
  answer,
  pending,
  control,
}: {
  readonly intent: RoundControlIntent;
  readonly commandId: string;
  readonly version: number;
  readonly post: (form: FormData) => void;
  readonly answer: RoundFormState;
  readonly pending: boolean;
  readonly control: string;
}) {
  const preserved = answer.values.type === intent.type ? answer.values : {};
  const confirmation = answer.confirmation && preserved.type === intent.type;
  return (
    <form action={post} aria-busy={pending} className="flex flex-col gap-1">
      <input type="hidden" name="version" value="1" />
      <input
        type="hidden"
        name="commandId"
        value={preserved.commandId ?? commandId}
      />
      <input
        type="hidden"
        name="expectedVersion"
        value={preserved.expectedVersion ?? version}
      />
      <input type="hidden" name="type" value={intent.type} />
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
      <button
        id={`${control}-${intent.type}`}
        type="submit"
        disabled={pending || !intent.enabled}
        className="inline-flex h-room-target cursor-pointer items-center justify-center rounded-sm border border-border-strong px-4 text-sm font-strong whitespace-nowrap hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
      >
        {confirmation ? `Confirm ${intent.label.toLowerCase()}` : intent.label}
      </button>
    </form>
  );
}
/** Feedback survives a canonical revision that removes the submitted action. */
export function RoundCommandActions({
  view,
  actorId,
  nowMs,
  ids,
  action,
  onAnswer,
  children,
}: {
  readonly children: (actions: ReactNode) => ReactNode;
  readonly view: RoundView;
  readonly actorId: string;
  readonly nowMs: number;
  readonly ids: RoundCommandIds;
  readonly action: FormAction<RoundFormState>;
  readonly onAnswer: (answer: RoundFormState) => void;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    unanswered,
    roundCommandUnavailable,
  );
  const router = useRouter();
  useEffect(() => {
    if (!pending && !answer.unacknowledged && !isLiveDebater(view, actorId))
      router.replace(`/rounds/${view.id}`);
  }, [pending, answer.unacknowledged, view, actorId, router]);
  const feedback = useId(),
    control = useId();
  useEffect(() => {
    if (answer !== unanswered && (answer.view || answer.error))
      onAnswer(answer);
  }, [answer, onAnswer]);
  useFocusAfterAnswer(
    answer,
    answer.error ? feedback : `${control}-${answer.values.type}`,
    !pending,
  );
  const actions = !answer.unacknowledged ? (
    <>
      {roundControlIntents(view, actorId, nowMs).map((intent) => (
        <CommandForm
          key={intent.type}
          intent={intent}
          commandId={ids[intent.type]}
          version={view.version}
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
  return (
    <>
      <div id={feedback} tabIndex={-1}>
        <FormError error={answer.error} />
      </div>
      <UnacknowledgedCommand answer={answer} post={post} pending={pending} />
      {children(actions)}
    </>
  );
}
