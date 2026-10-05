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
        <Notice icon="clock">Full. You will join the waitlist.</Notice>
      ) : null}
      <Step title="Check you can enter">
        <CheckList
          items={[
            `Rating ${viewer.rating}, ${viewer.established ? 'established' : 'provisional'}`,
            open
              ? 'Open to every rating'
              : `For ratings ${bandLabel(tournament.band)}`,
            'Not judging this tournament',
          ]}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="conflicts" className="text-base font-strong text-ink">
            Conflicts to avoid (optional)
          </label>
          <textarea
            id="conflicts"
            rows={3}
            placeholder="Clubs, schools or debaters"
            className="w-full rounded-md border border-border bg-surface-raised p-3 text-base text-ink"
          />
          <p className="text-sm text-ink-faint">
            Private: only the pairing system reads this.
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
        Shown on the public entrants list.
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
            {`Full. You join the waitlist at position ${flow.position}.`}
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
            <span>I agree to the tournament rules.</span>
          </label>
          <label className={tick}>
            <input
              type="checkbox"
              name="agree"
              defaultChecked={ticks.agree}
              className="mt-1"
            />
            <span>I will check in 10 minutes before each round.</span>
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

export function DoneStep({ flow }: { readonly flow: Flow }) {
  const { tournament } = flow;
  return (
    <div className={card}>
      <h2 role="status" className="text-lg font-strong text-ink">
        {flow.waitlist ? 'You are on the waitlist' : 'You are registered'}
      </h2>
      {flow.waitlist ? (
        <p className="text-base text-ink-muted">{`Position ${flow.position}`}</p>
      ) : null}
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
