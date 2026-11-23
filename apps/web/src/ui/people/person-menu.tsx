'use client';

import { useAnswer, useDeliver } from '../edge/use-answer';
import { useDocumentEvent } from '../edge/use-dom-events';
import { Button } from '../components/button/button';
import { StatusRegion } from '../components/status-region/status-region';
import { Dialog } from '../components/dialog/dialog';
import { competitionTypes, type CompetitionType } from '@daisy/protocol/round';
import {
  reportReasonLabels,
  reportReasons,
  type ReportReason,
} from '@daisy/protocol/reports';
import { type ChallengeList } from '@daisy/protocol/challenges';
import { type Person } from '@daisy/protocol/people-list';
import { ShellLink as Link } from '../layout/app-shell/shell-link';
import { useId, useRef, useState } from 'react';
import {
  challengeFields,
  challengeFormUnavailable,
  initialChallengeForm,
  type ChallengeFormState,
} from '../../features/challenges/forms';
import { destinationOf } from '../../features/forms/form-state';
import {
  friendFormUnavailable,
  initialFriendForm,
} from '../../features/friends/forms';
import {
  creationFields,
  creationFormUnavailable,
  creationIdle,
} from '../../features/messaging/forms/create-form';
import {
  initialPersonBlock,
  personBlockNotice,
  personBlockUnavailable,
} from '../../features/contacts/block-form';
import {
  initialReportForm,
  reportFields,
  reportFormUnavailable,
} from '../../features/reports/form';
import { cn } from '../cn';
import { buttonClass } from '../components/button/button-class';
import { useFormAction } from '../form-action/form-action';
import { announceShellNavigation } from '../layout/app-shell/shell-link';
import { useMovedOn } from '../form-action/use-moved-on';
import { anchorAt, MemberCardBody } from './member-card';
import { useChallenges } from '../challenges/challenge-provider';
import { challengeModeLine } from '../../features/challenges/challenge-lobby';
import { usePeople } from './people-provider';
import type { PersonActions } from './person-actions';
import { publicNameLabel } from '../profile/public-name';

const item =
  'flex min-h-nav-target w-full items-center rounded-sm px-2 text-left text-sm text-ink no-underline hover:bg-surface-overlay hover:no-underline disabled:cursor-default disabled:text-ink-muted';
const chip =
  'min-h-nav-target flex-1 rounded-sm border border-border-strong px-1 text-sm font-semibold text-ink aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50';

const modeLabels: Readonly<Record<CompetitionType, string>> = {
  ranked: 'Ranked',
  casual: 'Casual',
};

/** Open to a challenge: anyone not Busy, away or online, and not already placed. */
export const canBeChallenged = (member: Person): boolean =>
  member.status === 'online' || member.status === 'away';

export const outgoingTo = (challenges: ChallengeList, username: string) =>
  challenges.outgoing.find((row) => row.username === username);

/** The friend form's button, closing the menu once it has answered. */
function FriendItem({
  action,
  username,
  intent,
  label,
  onDone,
}: {
  readonly action: PersonActions['friend'];
  readonly username: string;
  readonly intent: 'request' | 'accept' | 'cancel';
  readonly label: string;
  readonly onDone: () => void;
}) {
  const [, post, pending] = useFormAction(
    action,
    initialFriendForm(username),
    friendFormUnavailable,
    onDone,
  );
  return (
    <form action={post}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="username" value={username} />
      <Button
        variant="unstyled"
        type="submit"
        disabled={pending}
        className={item}
      >
        {label}
      </Button>
    </form>
  );
}

function CancelChallengeItem({
  action,
  challengeId,
  onDone,
}: {
  readonly action: PersonActions['endChallenge'];
  readonly challengeId: string;
  readonly onDone: () => void;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialChallengeForm,
    challengeFormUnavailable,
  );
  const { noteCancelled, forgetCancelled } = useChallenges();
  useAnswer(answer, () => {
    if (challengeFields(answer).refusal) forgetCancelled(challengeId);
    onDone();
  });
  return (
    <form action={post} onSubmit={() => noteCancelled(challengeId)}>
      <input type="hidden" name="command" value="cancel" />
      <input type="hidden" name="challengeId" value={challengeId} />
      <Button
        variant="unstyled"
        type="submit"
        disabled={pending}
        className={item}
      >
        Cancel challenge
      </Button>
    </form>
  );
}

function MessageItem({
  action,
  username,
}: {
  readonly action: PersonActions['message'];
  readonly username: string;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    creationIdle('', username),
    creationFormUnavailable,
  );
  const next = destinationOf(answer);
  useMovedOn(next, announceShellNavigation);
  return (
    <form action={post}>
      <input type="hidden" name="recipients" value={username} />
      <input type="hidden" name="introduction" value="" />
      <Button
        variant="unstyled"
        type="submit"

        disabled={pending || next !== undefined}
        className={item}
      >
        Message
      </Button>
      {creationFields(answer).notice ? (
        <StatusRegion
          as="p"
          role="status"
          className="px-2 text-xs text-ink-muted"
        >
          {`Could not open a conversation with @${username}. Try again.`}
        </StatusRegion>
      ) : null}
    </form>
  );
}

function BlockItem({
  action,
  username,
  onDone,
}: {
  readonly action: PersonActions['block'];
  readonly username: string;
  readonly onDone: () => void;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialPersonBlock,
    personBlockUnavailable,
  );
  useAnswer(answer, () => {
    if (answer.kind === 'blocked') onDone();
  });
  const notice =
    answer.kind === 'blocked' ? undefined : personBlockNotice(answer);
  return (
    <form action={post}>
      <input type="hidden" name="username" value={username} />
      <Button
        variant="unstyled"
        type="submit"
        disabled={pending}
        className={item}
      >
        Block
      </Button>
      {notice ? (
        <StatusRegion
          as="p"
          role="status"
          className="px-2 text-xs text-ink-muted"
        >
          {notice}
        </StatusRegion>
      ) : null}
    </form>
  );
}

/** Whether the offer went out, which is when its menu closes. */
function wasSent(answer: ChallengeFormState): boolean {
  switch (answer.kind) {
    case 'sent':
      return true;
    case 'idle':
    case 'refused':
    case 'done':
    case 'moved':
      return false;
  }
}

function ChallengeView({
  action,
  member,
  onBack,
  onDone,
}: {
  readonly action: PersonActions['sendChallenge'];
  readonly member: Pick<Person, 'username' | 'challengeModes'>;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const { username } = member;
  const { memberDivision } = useChallenges();
  const ranked = member.challengeModes.includes('ranked');
  const line = ranked ? null : challengeModeLine(memberDivision);
  const [mode, setMode] = useState<CompetitionType>(
    ranked ? 'ranked' : 'casual',
  );
  const [answer, post, pending] = useFormAction(
    action,
    initialChallengeForm,
    challengeFormUnavailable,
  );
  useAnswer(answer, () => {
    if (wasSent(answer)) onDone();
  });
  const { refusal } = challengeFields(answer);
  const ladderLineId = useId();
  return (
    <form action={post} className="flex flex-col gap-2">
      <input type="hidden" name="username" value={username} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="format" value="freestyle" />
      <div role="group" aria-label="Mode" className="flex gap-1">
        {competitionTypes.map((value) => (
          <Button
            variant="unstyled"
            key={value}
            type="button"
            aria-pressed={mode === value}
            disabled={value === 'ranked' && !ranked}
            aria-describedby={
              value === 'ranked' && line !== null ? ladderLineId : undefined
            }
            onClick={() => setMode(value)}
            className={chip}
          >
            {modeLabels[value]}
          </Button>
        ))}
      </div>
      {line === null ? null : (
        <p id={ladderLineId} className="text-sm text-ink-muted">
          {line}
        </p>
      )}
      {refusal ? (
        <StatusRegion as="p" role="status" className="text-sm text-ink-muted">
          {refusal}
        </StatusRegion>
      ) : null}
      <Button
        variant="unstyled"
        type="submit"
        disabled={pending}
        className={cn(buttonClass('primary'), 'w-full')}
      >
        Send challenge
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={onBack}
        className={cn(item, 'w-auto self-start text-ink-muted')}
      >
        Back
      </Button>
    </form>
  );
}

function ReportView({
  action,
  username,
  onBack,
  onDone,
}: {
  readonly action: PersonActions['report'];
  readonly username: string;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [answer, post, pending] = useFormAction(
    action,
    initialReportForm,
    reportFormUnavailable,
  );
  const { filed, refusal } = reportFields(answer);
  useAnswer(answer, () => {
    if (filed) onDone();
  });
  return (
    <form action={post} className="flex flex-col gap-2">
      <input type="hidden" name="username" value={username} />
      <input type="hidden" name="surface" value="people" />
      <input type="hidden" name="reason" value={reason ?? ''} />
      <div role="group" aria-label="Reason" className="flex flex-col gap-1">
        {reportReasons.map((value) => (
          <Button
            variant="unstyled"
            key={value}
            type="button"
            aria-pressed={reason === value}
            onClick={() => setReason(value)}
            className={cn(chip, 'text-left')}
          >
            {reportReasonLabels[value]}
          </Button>
        ))}
      </div>
      {refusal ? (
        <StatusRegion as="p" role="status" className="text-sm text-ink-muted">
          {refusal}
        </StatusRegion>
      ) : null}
      <Button
        variant="unstyled"
        type="submit"
        disabled={pending || reason === null}
        className={cn(buttonClass('primary'), 'w-full')}
      >
        Send report
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={onBack}
        className={cn(item, 'w-auto self-start text-ink-muted')}
      >
        Back
      </Button>
    </form>
  );
}

/**
 * The one menu a person opens by right-click, three dots, long press or click
 * (ADR 0103): their card, then what the viewer can do. A sheet on a phone.
 */
export function PersonMenu({
  member,
  actions,
  reported,
  onReported,
  top,
  onClose,
}: {
  readonly member: Person;
  readonly actions: PersonActions;
  readonly reported: boolean;
  readonly onReported: () => void;
  readonly top: number;
  readonly onClose: () => void;
}) {
  const { refresh: refreshPeople } = usePeople();
  const {
    challenges,
    refresh: refreshChallenges,
    noteCancelled,
    memberDivision,
  } = useChallenges();
  const refresh = () => {
    refreshPeople();
    refreshChallenges();
  };
  const [view, setView] = useState<'menu' | 'challenge' | 'report'>('menu');
  const finish = () => {
    refresh();
    onClose();
  };
  const outgoing = outgoingTo(challenges, member.username);
  const { username, relation } = member;
  // Into the dialog on open, and Escape closes it from anywhere; whoever opened
  // it hands focus back to the row.
  const dialog = useRef<HTMLElement | null>(null);
  // Each view replaces the focused control, so focus moves in with every view.
  useDeliver(view, () => {
    dialog.current?.querySelector<HTMLElement>('button, a, select')?.focus();
  });
  useDocumentEvent('keydown', (event) => {
    if (event.key === 'Escape') onClose();
  });
  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-30 max-narrow:bg-scrim"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <Dialog
        as="section"

        aria-label={publicNameLabel(member)}
        ref={(element) => {
          dialog.current = element;
          anchorAt(top)(element);
        }}
        className="absolute person-anchor right-full z-40 mr-2 flex w-person-card flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-3 max-narrow:fixed max-narrow:inset-x-0 max-narrow:bottom-0 max-narrow:mr-0 max-narrow:w-auto max-narrow:rounded-b-none"
      >
        <MemberCardBody member={member} viewer={memberDivision} />
        <hr className="border-border" />
        {view === 'menu' ? (
          <div className="flex flex-col">
            {outgoing ? (
              <CancelChallengeItem
                action={actions.endChallenge}
                challengeId={outgoing.id}
                onDone={finish}
              />
            ) : canBeChallenged(member) && member.challengeModes.length > 0 ? (
              <Button
                variant="unstyled"
                type="button"

                onClick={() => setView('challenge')}
                className={cn(item, 'font-bold')}
              >
                Challenge
              </Button>
            ) : null}
            {relation === 'none' ? (
              <FriendItem
                action={actions.friend}
                username={username}
                intent="request"
                label="Add friend"
                onDone={finish}
              />
            ) : null}
            {relation === 'incoming' ? (
              <FriendItem
                action={actions.friend}
                username={username}
                intent="accept"
                label="Accept friend request"
                onDone={finish}
              />
            ) : null}
            {relation === 'outgoing' ? (
              <FriendItem
                action={actions.friend}
                username={username}
                intent="cancel"
                label="Cancel friend request"
                onDone={finish}
              />
            ) : null}
            <MessageItem action={actions.message} username={username} />
            <Link href={`/profile/${username}`} className={item}>
              Profile
            </Link>
            <hr className="my-1 border-border" />
            <Button
              variant="unstyled"
              type="button"

              disabled={reported}
              onClick={() => setView('report')}
              className={item}
            >
              {reported ? 'Reported' : 'Report'}
            </Button>
            <BlockItem
              action={actions.block}
              username={username}
              onDone={() => {
                if (outgoing) noteCancelled(outgoing.id);
                finish();
              }}
            />
          </div>
        ) : null}
        {view === 'challenge' ? (
          <ChallengeView
            action={actions.sendChallenge}
            member={member}
            onBack={() => setView('menu')}
            onDone={finish}
          />
        ) : null}
        {view === 'report' ? (
          <ReportView
            action={actions.report}
            username={username}
            onBack={() => setView('menu')}
            onDone={() => {
              onReported();
              setView('menu');
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
