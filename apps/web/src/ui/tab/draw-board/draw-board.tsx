import Link from 'next/link';
import type {
  DrawBoard as Read,
  FixtureFlag,
} from '../../../features/tab/draw';
import type { TimelineRail } from '../../../features/tab/tournament';
import { cn } from '../../cn';
import { buttonClass } from '../../components/button/button-class';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { ChoiceField } from '../choice-field/choice-field';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import {
  eyebrowClass,
  ListCard,
  ListHeading,
  ListRow,
} from '../list-card/list-card';

const count = (n: number, one: string, many: string) =>
  `${n === 0 ? 'no' : n} ${n === 1 ? one : many}`;

/** What the draft is and what it cost: its version, basis and the engine's report. */
export const draftSummary = (draw: Read): string =>
  [
    `Draft ${draw.version}`,
    draw.basis,
    `${count(draw.rulesBroken, 'rule', 'rules')} broken`,
    `${count(draw.preferencesBent, 'preference', 'preferences')} bent`,
  ].join(' · ');

const flagClass = (flag: FixtureFlag) =>
  flag.severity === 'note' ? '' : 'font-strong text-live';

/**
 * A draft draw: its fixtures by record group, why the chosen fixture was
 * made, what editing it would cost, and the way back a draft or on to
 * publishing.
 */
export function DrawBoard({
  rail,
  current,
  draw,
}: {
  readonly rail: TimelineRail;
  readonly current: string;
  readonly draw: Read;
}) {
  const chosen = draw.selected;
  return (
    <HostShell
      rail={rail}
      current={current}
      {...(chosen === null
        ? {}
        : {
            asideLabel: chosen.title,
            aside: (
              <>
                <h2 className="font-display text-xl font-bold">
                  {chosen.title}
                </h2>
                <section className="flex flex-col gap-2">
                  <h3 className={eyebrowClass}>Why this fixture</h3>
                  {chosen.why.map((reason) => (
                    <p key={reason} className="text-sm">
                      {reason}
                    </p>
                  ))}
                </section>
                <section className="flex flex-col gap-2">
                  <h3 className={eyebrowClass}>Seats</h3>
                  {chosen.seats.map((seat) => (
                    <ChoiceField
                      key={seat.label}
                      id={`seat-${seat.label.toLowerCase()}`}
                      choice={seat}
                      layout="beside"
                    />
                  ))}
                </section>
                {chosen.alternative === null ? null : (
                  <section className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-4">
                    <h3 className={eyebrowClass}>
                      {chosen.alternative.heading}
                    </h3>
                    <p className="text-sm">
                      {chosen.alternative.cost}
                      {chosen.alternative.breaksRule === null
                        ? null
                        : ` That breaks the rule "${chosen.alternative.breaksRule}", so publishing it needs an override with a reason.`}
                    </p>
                    <ActionButton action={chosen.alternative.show} />
                  </section>
                )}
              </>
            ),
          })}
    >
      <EventSwitcher event={draw.event} />
      <PageHeader
        title={draw.title}
        lede={draftSummary(draw)}
        actions={
          <>
            <ActionButton action={draw.again} />
            <ActionButton action={draw.publish} />
          </>
        }
      />
      <ListCard>
        {draw.groups.map((group) => (
          <section key={group.record}>
            <ListHeading>{group.record}</ListHeading>
            <ul>
              {group.fixtures.map((fixture) => (
                <ListRow
                  key={fixture.id}
                  title={fixture.title}
                  tone={fixture.selected ? 'selected' : 'plain'}
                  current={fixture.selected}
                  detail={
                    <>
                      {fixture.judges}
                      {fixture.flags.map((flag) => (
                        <span key={flag.text} className={flagClass(flag)}>
                          {' '}
                          · {flag.text}
                        </span>
                      ))}
                    </>
                  }
                  trailing={
                    <Link
                      href={fixture.href}
                      scroll={false}
                      aria-label={`Open: ${fixture.title}`}
                      className={cn(
                        buttonClass(fixture.selected ? 'primary' : 'secondary'),
                        'no-underline hover:no-underline',
                      )}
                    >
                      Open
                    </Link>
                  }
                />
              ))}
            </ul>
          </section>
        ))}
        {draw.rest === null ? null : <ListHeading>{draw.rest}</ListHeading>}
      </ListCard>
      {draw.back === null ? null : (
        <p className="text-sm text-ink-muted">
          Draft {draw.version}. <ActionLink action={draw.back} />
        </p>
      )}
    </HostShell>
  );
}
