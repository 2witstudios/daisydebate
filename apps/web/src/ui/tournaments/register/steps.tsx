import type { ReactNode } from 'react';
import {
  registerHref,
  type RegisterScreen,
} from '../../../features/tournaments/register-flow';
import { formatWhen } from '../../../features/tournaments/dates';
import {
  bandLabel,
  rulesLabel,
  structureLabel,
} from '../../../features/tournaments/labels';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { buttonClass } from '../../components/button/button-class';
import { CheckList } from '../check-list/check-list';
import { FactList } from '../fact-list/fact-list';
import { InertAction } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { Notice } from '../notice/notice';
import { Person } from '../person/person';

type Flow = Extract<RegisterScreen, { kind: 'flow' }>;

const card = 'flex flex-col gap-5 rounded-xl bg-surface p-6 shadow-1';
const actions = 'flex flex-wrap justify-between gap-3';

function Step({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">{title}</h2>
      {children}
    </div>
  );
}

export function EligibilityStep({ flow }: { readonly flow: Flow }) {
  const { tournament, viewer } = flow;
  const open = tournament.band.min === null && tournament.band.max === null;
  return (
    <>
      {flow.waitlist ? (
        <Notice icon="clock">
          {`This tournament is full. All ${tournament.places} places are taken, so you can join the waitlist and will be entered automatically if a place opens. You can leave the waitlist at any time.`}
        </Notice>
      ) : null}
      <Step title="Check you can enter">
        <CheckList
          items={[
            'You have a username and can be seated.',
            `Your rating: ${viewer.rating}, ${viewer.established ? 'established' : 'provisional'}. ${open ? 'This tournament is open to every rating.' : `This tournament is for ratings ${bandLabel(tournament.band)}.`}`,
            'Your account is in good standing.',
            'You are not registered to judge in this tournament. You cannot do both.',
          ]}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="conflicts" className="text-base font-strong text-ink">
            Conflicts to avoid (optional)
          </label>
          <textarea
            id="conflicts"
            rows={3}
            disabled
            placeholder="Clubs, schools or debaters you should not be paired against or judged by"
            className="w-full rounded-md border border-border bg-surface-raised p-3 text-base text-ink disabled:opacity-60"
          />
          <p className="text-sm text-ink-faint">
            Private: only the pairing system reads this, and it is never shown
            to other entrants. Recording conflicts needs the registration
            service, so this box is off for now.
          </p>
        </div>
        <div className="flex justify-end">
          <LinkButton
            href={registerHref(tournament.id, 'entry')}
            variant="primary"
          >
            Continue
          </LinkButton>
        </div>
      </Step>
    </>
  );
}

export function EntryStep({ flow }: { readonly flow: Flow }) {
  const { tournament, viewer } = flow;
  return (
    <Step title="You enter as yourself">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <Person handle={viewer.handle} rating={viewer.rating} />
        <span className="text-sm text-ink-muted">
          {viewer.established ? 'Established' : 'Provisional'}
        </span>
      </div>
      <p className="text-base text-ink-muted">
        Your handle and rating are shown on the public entrants list. Seeds
        follow rating when registration closes.
      </p>
      <div className={actions}>
        <LinkButton href={registerHref(tournament.id, 'eligibility')}>
          Back
        </LinkButton>
        <LinkButton
          href={registerHref(tournament.id, 'review')}
          variant="primary"
        >
          Continue
        </LinkButton>
      </div>
    </Step>
  );
}

const tick = 'flex items-start gap-3 text-base text-ink';

export function ReviewStep({ flow }: { readonly flow: Flow }) {
  const { tournament, ticks } = flow;
  return (
    <form method="get" action={tournamentRoutes.enter(tournament.id)}>
      <input type="hidden" name="step" value="done" />
      <Step title="Review and confirm">
        <FactList
          facts={[
            ['Tournament', tournament.name],
            [
              'Structure and rules',
              `${structureLabel(tournament.structure)}, ${rulesLabel(tournament.rules).toLowerCase()}`,
            ],
            ['Starts', formatWhen(tournament.startsAt)],
            ['Rating', 'Unrated'],
          ]}
        />
        {flow.waitlist ? (
          <Notice icon="clock">
            {`This tournament is full. You will be waitlisted at position ${flow.position} and entered automatically if a place opens. You can leave the waitlist at any time.`}
          </Notice>
        ) : null}
        <div className="flex flex-col gap-3">
          <label className={tick}>
            <input
              type="checkbox"
              name="rules"
              defaultChecked={ticks.rules}
              className="mt-1"
            />
            <span>
              I agree to the tournament rules, including unrated play and judges
              assigned by Daisy.
            </span>
          </label>
          <label className={tick}>
            <input
              type="checkbox"
              name="agree"
              defaultChecked={ticks.agree}
              className="mt-1"
            />
            <span>
              I will check in 10 minutes before each round. I understand I can
              forfeit if I am absent 10 minutes after the start.
            </span>
          </label>
        </div>
        {flow.missing ? (
          <p role="alert" className="text-base font-strong text-live">
            Tick both boxes to continue.
          </p>
        ) : null}
        <div className={actions}>
          <LinkButton href={registerHref(tournament.id, 'entry')}>
            Back
          </LinkButton>
          <button type="submit" className={buttonClass('primary')}>
            {flow.waitlist ? 'Join the waitlist' : 'Confirm registration'}
          </button>
        </div>
      </Step>
    </form>
  );
}

const next = [
  'Registration closes and the bracket posts an hour later.',
  'Each round, your pairing, room, time and judge appear in your event.',
  'Check-in opens 10 minutes before you are due in the room.',
];

export function DoneStep({ flow }: { readonly flow: Flow }) {
  const { tournament } = flow;
  return (
    <div className={card}>
      <h2 role="status" className="text-lg font-strong text-ink">
        {flow.waitlist ? 'You are on the waitlist' : 'You are registered'}
      </h2>
      <p className="text-base text-ink-muted">
        {flow.waitlist
          ? `Position ${flow.position}. If a place opens you are entered automatically and we tell you. You can leave any time.`
          : `You are in ${tournament.name}. Seeds are set when registration closes, and we will tell you your bracket and first opponent as soon as they are published.`}
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          What happens next
        </h3>
        <CheckList items={next} />
      </div>
      <div className="flex flex-wrap gap-3">
        <LinkButton
          href={tournamentRoutes.detail(tournament.id)}
          variant="primary"
        >
          View the tournament
        </LinkButton>
        <InertAction id="calendar" />
        <LinkButton
          href={tournamentRoutes.withdraw(tournament.id)}
          variant="ghost"
        >
          {flow.waitlist ? 'Leave the waitlist' : 'Withdraw my registration'}
        </LinkButton>
      </div>
    </div>
  );
}
