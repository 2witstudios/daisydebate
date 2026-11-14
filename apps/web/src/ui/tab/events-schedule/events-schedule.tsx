import Link from 'next/link';
import type { EventsSchedule as Read } from '../../../features/tab/events';
import type { TimelineRail } from '../../../features/tab/tournament';
import { Button } from '../../components/button/button';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { ChoiceField } from '../choice-field/choice-field';
import { HostShell } from '../host-shell/host-shell';
import {
  eyebrowClass,
  ListCard,
  ListHeading,
  ListRow,
} from '../list-card/list-card';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';

/** A tournament's events by the group they run in, with one event's form beside them. */
export function EventsSchedule({
  rail,
  schedule,
  submit,
}: {
  readonly rail: TimelineRail;
  readonly schedule: Read;
  readonly submit: SampleSubmit;
}) {
  const form = schedule.selected;
  return (
    <HostShell
      rail={rail}
      current="events"
      {...(form === null
        ? {}
        : {
            asideLabel: form.name,
            aside: (
              <SampleForm
                action={submit('Save')}
                label={form.name}
                className="flex flex-col gap-4"
              >
                <h2 className="font-display text-xl font-bold">{form.name}</h2>
                <dl className="flex flex-col">
                  <dt className={eyebrowClass}>Format</dt>
                  <dd className="text-sm">
                    {form.format.value} · {form.format.source}
                  </dd>
                </dl>
                <ChoiceField id="event-divisions" choice={form.divisions} />
                <dl className="flex flex-col">
                  <dt className={eyebrowClass}>Who counts as a novice</dt>
                  <dd className="text-sm">
                    {form.novice.value} · {form.novice.source}
                  </dd>
                </dl>
                <div className="grid grid-cols-3 gap-3">
                  <ChoiceField
                    id="event-prelim-rounds"
                    choice={form.prelimRounds}
                  />
                  <ChoiceField id="event-open-break" choice={form.openBreak} />
                  <ChoiceField
                    id="event-novice-break"
                    choice={form.noviceBreak}
                  />
                </div>
                <ChoiceField
                  id="event-double-qualifier"
                  choice={form.doubleQualifier}
                />
                <ChoiceField id="event-runs-with" choice={form.runsWith} />
                <p className="text-sm text-ink-muted">
                  Ballot, pairing rules, tiebreaks and resolutions for this
                  event are in <ActionLink action={form.settings} />. Who sees
                  results and when is set once for the tournament.
                </p>
                <div className="flex items-center gap-4">
                  <Button type="submit">Save</Button>
                  <ActionLink action={form.remove} />
                </div>
              </SampleForm>
            ),
          })}
    >
      <PageHeader
        title="Events and schedule"
        lede={schedule.lede}
        actions={schedule.actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      />
      <ListCard>
        {schedule.groups.map((group) => (
          <section key={group.name}>
            <ListHeading>
              {group.name} · {group.times}
            </ListHeading>
            <ul>
              {group.events.map((event) => (
                <ListRow
                  key={event.slug}
                  title={
                    <Link href={event.href} scroll={false} className="text-ink">
                      {event.name}
                    </Link>
                  }
                  detail={event.summary}
                  tone={event.slug === form?.slug ? 'held' : 'plain'}
                  current={event.slug === form?.slug}
                />
              ))}
            </ul>
          </section>
        ))}
      </ListCard>
      <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
        <strong className="font-strong">One person can enter</strong>{' '}
        {schedule.entryLimit.rule}. {schedule.entryLimit.source}
      </p>
      <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
        <strong className="font-strong">Judges are one pool.</strong>{' '}
        {schedule.judgePool.rule}{' '}
        <ActionLink action={schedule.judgePool.action} />
      </p>
    </HostShell>
  );
}
