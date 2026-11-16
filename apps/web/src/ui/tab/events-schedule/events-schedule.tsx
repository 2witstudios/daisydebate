import type { ReactNode } from 'react';
import Link from 'next/link';
import type { EventsSchedule as Read } from '../../../features/tab/events';
import type { TimelineRail } from '../../../features/tab/tournament';
import { Button } from '../../components/button/button';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, SentenceLink } from '../action-control/action-control';
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
  stored,
}: {
  readonly rail: TimelineRail;
  readonly schedule: Read;
  readonly submit?: SampleSubmit;
  readonly stored?: {
    readonly aside: {
      readonly title: string;
      readonly content: ReactNode;
    } | null;
    readonly selectedEventId: string | null;
    readonly schedule: ReactNode;
  };
}) {
  const form = schedule.selected;
  return (
    <HostShell
      rail={rail}
      current="events"
      {...(stored
        ? stored.aside
          ? { asideLabel: stored.aside.title, aside: stored.aside.content }
          : {}
        : form === null || !submit
          ? {}
          : {
              asideLabel: form.name,
              aside: (
                <SampleForm
                  action={submit('Save')}
                  label={form.name}
                  className="flex flex-col gap-4"
                >
                  <h2 className="font-display text-xl font-bold">
                    {form.name}
                  </h2>
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
                    <ChoiceField
                      id="event-open-break"
                      choice={form.openBreak}
                    />
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
                    event are in <SentenceLink action={form.settings} />. Who
                    sees results and when is set once for the tournament.
                  </p>
                  <div className="flex items-center gap-4">
                    <Button type="submit">Save</Button>
                    <ActionButton action={form.remove} />
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
              {[group.name || 'No time slot', group.times]
                .filter(Boolean)
                .join(' · ')}
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
                  tone={
                    event.slug === (stored?.selectedEventId ?? form?.slug)
                      ? 'held'
                      : 'plain'
                  }
                  current={
                    event.slug === (stored?.selectedEventId ?? form?.slug)
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </ListCard>
      {schedule.entryLimit.kind === 'unconfigured' ? (
        <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
          Entry terms are unconfigured.
        </p>
      ) : (
        <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
          <strong className="font-strong">One person can enter</strong>{' '}
          {schedule.entryLimit.rule}. {schedule.entryLimit.source}
        </p>
      )}
      <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
        <p>
          <strong className="font-strong">Judges are one pool.</strong>{' '}
          {schedule.judgePool.kind === 'unconfigured'
            ? 'Judge obligations are unconfigured.'
            : schedule.judgePool.rule}
        </p>
        {schedule.judgePool.action ? (
          <ActionButton size="small" action={schedule.judgePool.action} />
        ) : null}
      </div>
      {stored?.schedule}
    </HostShell>
  );
}
