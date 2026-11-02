'use client';

import {
  ratingLadders,
  competitionTypes,
  reportReasonLabels,
  reportReasons,
  type RatingLadder,
  type ChallengeList,
  type CompetitionType,
  type OnlineMember,
  type ReportReason,
} from '@daisy/protocol';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { challengeFormUnavailable } from '../../features/challenges/forms';
import { friendFormUnavailable } from '../../features/friends/forms';
import { creationFormUnavailable } from '../../features/messaging/forms/create-form';
import { personBlockFailedNotice } from '../../features/contacts/block-form';
import { reportFailedNotice } from '../../features/reports/form';
import { cn } from '../cn';
import { buttonClass } from '../components/button/button-class';
import { useFormAction } from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { anchorAt, MemberCardBody } from './member-card';
import { useChallenges } from '../challenges/challenge-provider';
import { useOnline } from './online-provider';
import type { PersonActions } from './person-actions';

const item =
  'flex min-h-nav-target w-full items-center rounded-sm px-2 text-left text-sm text-ink no-underline hover:bg-surface-overlay hover:no-underline disabled:cursor-default disabled:text-ink-muted';
const chip =
  'min-h-nav-target flex-1 rounded-sm border border-border-strong px-1 text-sm font-semibold text-ink aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink';

const modeLabels: Readonly<Record<CompetitionType, string>> = {
  ranked: 'Ranked',
  casual: 'Casual',
};
const formatLabels: Readonly<Record<RatingLadder, string>> = {
  freestyle: 'Freestyle',
  policy: 'Policy',
  value: 'Value',
};

/** Open to a challenge: anyone not Busy, away or online, and not already placed. */
export const canBeChallenged = (member: OnlineMember): boolean =>
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
  const [answer, post, pending] = useFormAction(
    action,
    { username },
    friendFormUnavailable,
  );
  useAnswered(answer, onDone);
  return (
    <form action={post}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="username" value={username} />
      <button type="submit" disabled={pending} className={item}>
        {label}
      </button>
    </form>
  );
}

/** Runs `onDone` once for each answer after the first render's. */
function useAnswered(answer: unknown, onDone: () => void) {
  const [initial] = useState(answer);
  useEffect(() => {
    if (answer !== initial) onDone();
    // Only a new answer closes; a re-render with a new callback must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);
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
    {},
    challengeFormUnavailable,
  );
  const { noteCancelled, forgetCancelled } = useChallenges();
  useAnswered(answer, () => {
    if (answer.notice) forgetCancelled(challengeId);
    onDone();
  });
  return (
    <form action={post} onSubmit={() => noteCancelled(challengeId)}>
      <input type="hidden" name="command" value="cancel" />
      <input type="hidden" name="challengeId" value={challengeId} />
      <button type="submit" disabled={pending} className={item}>
        Cancel challenge
      </button>
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
    { requestId: '', recipients: username, title: '', introduction: '' },
    creationFormUnavailable,
  );
  useMovedOn(answer.next);
  return (
    <form action={post}>
      <input type="hidden" name="recipients" value={username} />
      <input type="hidden" name="introduction" value="" />
      <button
        type="submit"

        disabled={pending || answer.next !== undefined}
        className={item}
      >
        Message
      </button>
      {answer.notice ? (
        <p role="status" className="px-2 text-xs text-ink-muted">
          {`Could not open a conversation with @${username}. Try again.`}
        </p>
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
  const [answer, post, pending] = useFormAction(action, {}, () => ({
    notice: personBlockFailedNotice,
  }));
  useAnswered(answer, () => {
    if (answer.done) onDone();
  });
  return (
    <form action={post}>
      <input type="hidden" name="username" value={username} />
      <button type="submit" disabled={pending} className={item}>
        Block
      </button>
      {answer.notice && !answer.done ? (
        <p role="status" className="px-2 text-xs text-ink-muted">
          {answer.notice}
        </p>
      ) : null}
    </form>
  );
}

function ChallengeView({
  action,
  username,
  onBack,
  onDone,
}: {
  readonly action: PersonActions['sendChallenge'];
  readonly username: string;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const [mode, setMode] = useState<CompetitionType>('ranked');
  const [format, setFormat] = useState<RatingLadder>('freestyle');
  const [answer, post, pending] = useFormAction(
    action,
    {},
    challengeFormUnavailable,
  );
  useAnswered(answer, () => {
    if (answer.sent) onDone();
  });
  return (
    <form action={post} className="flex flex-col gap-2">
      <input type="hidden" name="username" value={username} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="format" value={format} />
      <div role="group" aria-label="Mode" className="flex gap-1">
        {competitionTypes.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={chip}
          >
            {modeLabels[value]}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Format" className="flex gap-1">
        {ratingLadders.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={format === value}
            onClick={() => setFormat(value)}
            className={chip}
          >
            {formatLabels[value]}
          </button>
        ))}
      </div>
      {answer.notice && !answer.sent ? (
        <p role="status" className="text-sm text-ink-muted">
          {answer.notice}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonClass('primary'), 'w-full')}
      >
        Send challenge
      </button>
      <button
        type="button"
        onClick={onBack}
        className={cn(item, 'w-auto self-start text-ink-muted')}
      >
        Back
      </button>
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
  const [answer, post, pending] = useFormAction(action, {}, () => ({
    notice: reportFailedNotice,
  }));
  useAnswered(answer, () => {
    if (answer.done) onDone();
  });
  return (
    <form action={post} className="flex flex-col gap-2">
      <input type="hidden" name="username" value={username} />
      <input type="hidden" name="surface" value="online" />
      <input type="hidden" name="reason" value={reason ?? ''} />
      <div role="group" aria-label="Reason" className="flex flex-col gap-1">
        {reportReasons.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={reason === value}
            onClick={() => setReason(value)}
            className={cn(chip, 'text-left')}
          >
            {reportReasonLabels[value]}
          </button>
        ))}
      </div>
      {answer.notice && !answer.done ? (
        <p role="status" className="text-sm text-ink-muted">
          {answer.notice}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || reason === null}
        className={cn(buttonClass('primary'), 'w-full')}
      >
        Send report
      </button>
      <button
        type="button"
        onClick={onBack}
        className={cn(item, 'w-auto self-start text-ink-muted')}
      >
        Back
      </button>
    </form>
  );
}

/**
 * The one menu a person opens by right-click, three dots, long press or click
 * (ADR 0098): their card, then what the viewer can do. A sheet on a phone.
 */
export function PersonMenu({
  member,
  actions,
  reported,
  onReported,
  top,
  onClose,
}: {
  readonly member: OnlineMember;
  readonly actions: PersonActions;
  readonly reported: boolean;
  readonly onReported: () => void;
  readonly top: number;
  readonly onClose: () => void;
}) {
  const { refresh: refreshOnline } = useOnline();
  const {
    challenges,
    refresh: refreshChallenges,
    noteCancelled,
  } = useChallenges();
  const refresh = () => {
    refreshOnline();
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
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('button, a, select')?.focus();
  }, [view]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
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
      <section
        role="dialog"
        aria-label={`@${username}`}
        ref={(element) => {
          dialog.current = element;
          anchorAt(top)(element);
        }}
        className="absolute person-anchor right-full z-40 mr-2 flex w-person-card flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-3 max-narrow:fixed max-narrow:inset-x-0 max-narrow:bottom-0 max-narrow:mr-0 max-narrow:w-auto max-narrow:rounded-b-none"
      >
        <MemberCardBody member={member} />
        <hr className="border-border" />
        {view === 'menu' ? (
          <div className="flex flex-col">
            {outgoing ? (
              <CancelChallengeItem
                action={actions.endChallenge}
                challengeId={outgoing.id}
                onDone={finish}
              />
            ) : canBeChallenged(member) ? (
              <button
                type="button"

                onClick={() => setView('challenge')}
                className={cn(item, 'font-bold')}
              >
                Challenge
              </button>
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
            <button
              type="button"

              disabled={reported}
              onClick={() => setView('report')}
              className={item}
            >
              {reported ? 'Reported' : 'Report'}
            </button>
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
            username={username}
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
      </section>
    </>
  );
}
