import type { DrawBoard as Read } from '../../../features/tab/draw';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { ChoiceField } from '../choice-field/choice-field';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { eyebrowClass } from '../list-card/list-card';
import { SearchableGroups } from '../searchable-groups/searchable-groups';

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
      <SearchableGroups
        label="Find an entry, school or judge"
        groups={[
          {
            heading: 'Look first',
            limit: 7,
            rows: draw.lookFirst.map((fixture) => ({
              title: fixture.title,
              detail: [
                fixture.judges,
                ...fixture.schools,
                ...fixture.flags.map((flag) => flag.text),
              ].join(' · '),
              action: {
                label: 'Open',
                href: fixture.href,
                primary: fixture.selected,
              },
            })),
          },
          ...draw.groups.map((group) => ({
            heading: group.record,
            limit: 2,
            rows: group.fixtures
              .filter((fixture) => fixture.flags.length === 0)
              .map((fixture) => ({
                title: fixture.title,
                detail: [fixture.judges, ...fixture.schools].join(' · '),
                action: {
                  label: 'Open',
                  href: fixture.href,
                  primary: fixture.selected,
                },
              })),
          })),
        ]}
      />
      {draw.back === null ? null : (
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <p>Draft {draw.version}.</p>
          <ActionButton size="small" action={draw.back} />
        </div>
      )}
    </HostShell>
  );
}
