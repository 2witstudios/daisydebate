'use client';

import { useAnswer, useDeliver } from '../edge/use-answer';
import { useDocumentEvent } from '../edge/use-dom-events';
import { Button } from '../components/button/button';
import { buttonClass } from '../components/button/button-class';
import { Announcement } from '../components/announcement/announcement';
import { DialogRegion } from '../components/dialog/dialog-region';
import { competitionTypes, type CompetitionType } from '@daisy/protocol/round';
import {
  reportReasonLabels,
  reportReasons,
  type ReportReason,
} from '@daisy/protocol/reports';
import { type ChallengeList } from '@daisy/protocol/challenges';
import { type Person } from '@daisy/protocol/people-list';
import { ShellLink as Link } from '../layout/app-shell/shell-link';
import { useId, useRef } from 'react';
import { useDriver } from '../edge/use-driver';
import {
  createPersonMenuDriver,
  personMenuStart,
  type PersonMenuEvent,
  type PersonMenuView,
} from './person-menu-driver';
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
import { useFormAction } from '../form-action/form-action';
import { announceShellNavigation } from '../layout/app-shell/shell-link';
import { useMovedOn } from '../form-action/use-moved-on';
import { anchorAt, MemberCardBody } from './member-card';
import { useChallenges } from '../challenges/challenge-provider';
import { challengeModeLine } from '../../features/challenges/challenge-lobby';
import { usePeople } from './people-provider';
import type { PersonActions } from './person-actions';
import { publicNameLabel } from '../profile/public-name';

/** A menu entry; as a button the `row` variant lays it out. */

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
      <Button variant="row" type="submit" disabled={pending} className="w-full">
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
      <Button variant="row" type="submit" disabled={pending} className="w-full">
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
        variant="row"
        type="submit"

        disabled={pending || next !== undefined}
        className="w-full"
      >
        Message
      </Button>
      {creationFields(answer).notice ? (
        <Announcement
          as="p"
          kind="progress"
          className="px-2 text-xs text-ink-muted"
        >
          {`Could not open a conversation with @${username}. Try again.`}
        </Announcement>
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
      <Button variant="row" type="submit" disabled={pending} className="w-full">
        Block
      </Button>
      {notice ? (
        <Announcement
          as="p"
          kind="progress"
          className="px-2 text-xs text-ink-muted"
        >
          {notice}
        </Announcement>
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
  mode,
  onMode,
  onBack,
  onDone,
}: {
  readonly action: PersonActions['sendChallenge'];
  readonly member: Pick<Person, 'username' | 'challengeModes'>;
  readonly mode: CompetitionType;
  readonly onMode: (mode: CompetitionType) => void;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const { username } = member;
  const { memberDivision } = useChallenges();
  const ranked = member.challengeModes.includes('ranked');
  const line = ranked ? null : challengeModeLine(memberDivision);
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
            variant="chip"
            key={value}
            type="button"
            aria-pressed={mode === value}
            disabled={value === 'ranked' && !ranked}
            aria-describedby={
              value === 'ranked' && line !== null ? ladderLineId : undefined
            }
            onClick={() => onMode(value)}
            className="flex-1"
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
        <Announcement as="p" kind="progress" className="text-sm text-ink-muted">
          {refusal}
        </Announcement>
      ) : null}
      <Button
        variant="primary"
        type="submit"
        disabled={pending}
        className="w-full"
      >
        Send challenge
      </Button>
      <Button
        variant="row-quiet"
        type="button"
        onClick={onBack}
        className="self-start"
      >
        Back
      </Button>
    </form>
  );
}

function ReportView({
  action,
  username,
  reason,
  onReason,
  onBack,
  onDone,
}: {
  readonly action: PersonActions['report'];
  readonly username: string;
  readonly reason: ReportReason | null;
  readonly onReason: (reason: ReportReason) => void;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
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
            variant="chip"
            key={value}
            type="button"
            aria-pressed={reason === value}
            onClick={() => onReason(value)}
            className="flex-1 text-left"
          >
            {reportReasonLabels[value]}
          </Button>
        ))}
      </div>
      {refusal ? (
        <Announcement as="p" kind="progress" className="text-sm text-ink-muted">
          {refusal}
        </Announcement>
      ) : null}
      <Button
        variant="primary"
        type="submit"
        disabled={pending || reason === null}
        className="w-full"
      >
        Send report
      </Button>
      <Button
        variant="row-quiet"
        type="button"
        onClick={onBack}
        className="self-start"
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

/** Focus enters the view the card now shows, on its first control. */
const focusViewStart = (card: HTMLElement | null, view: PersonMenuView) => {
  if (card?.dataset.personView !== view) return;
  card.querySelector<HTMLElement>('button, a, select')?.focus();
};

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
  const [shown, menu] = useDriver(
    () => personMenuStart,
    createPersonMenuDriver,
  );
  const { view } = shown;
  const send = (event: PersonMenuEvent) => menu?.send(event);
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
  useDeliver(view, (shown) => focusViewStart(dialog.current, shown));
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
      <DialogRegion
        as="section"

        aria-label={publicNameLabel(member)}
        data-person-view={view}
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
                variant="row"
                type="button"

                onClick={() =>
                  send({
                    type: 'challenge',
                    ranked: member.challengeModes.includes('ranked'),
                  })
                }
                className="w-full font-bold"
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
            <Link
              href={`/profile/${username}`}
              className={`${buttonClass('row')} w-full`}
            >
              Profile
            </Link>
            <hr className="my-1 border-border" />
            <Button
              variant="row"
              type="button"

              disabled={reported}
              onClick={() => send({ type: 'report' })}
              className="w-full"
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
        {shown.view === 'challenge' ? (
          <ChallengeView
            action={actions.sendChallenge}
            member={member}
            mode={shown.mode}
            onMode={(mode) => send({ type: 'mode', mode })}
            onBack={() => send({ type: 'menu' })}
            onDone={finish}
          />
        ) : null}
        {shown.view === 'report' ? (
          <ReportView
            action={actions.report}
            username={username}
            reason={shown.reason}
            onReason={(reason) => send({ type: 'reason', reason })}
            onBack={() => send({ type: 'menu' })}
            onDone={() => {
              onReported();
              send({ type: 'menu' });
            }}
          />
        ) : null}
      </DialogRegion>
    </>
  );
}
