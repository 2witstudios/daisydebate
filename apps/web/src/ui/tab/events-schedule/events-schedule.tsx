import type { ReactNode } from 'react';
import Link from 'next/link';
import type { CommandAction } from '../../../features/tab/action';
import type { EventFormContext } from '../../../features/tab/event-form';
import type { eventScheduleBoard } from '../../../features/tab/events';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import type { ReplayCommandAction } from '../../form-action/replay-command-form';
import { ActionButton } from '../action-control/action-control';
import { CommandControl } from '../action-control/command-control';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import {
  EventMetadataFields,
  ResolutionFields,
  RoundFields,
  SlotFields,
  StageFields,
} from './event-command-fields';

type Board = NonNullable<ReturnType<typeof eventScheduleBoard>>;
type Render = (
  action: CommandAction<EventFormContext>,
  fields?: ReactNode,
) => ReactNode;

function Editor({
  editor,
  render,
}: {
  readonly editor: NonNullable<Board['editor']>;
  readonly render: Render;
}) {
  return (
    <ListCard>
      <ListHeading>{editor.title}</ListHeading>
      <div className="flex flex-col gap-6 p-4">
        {editor.stages.map((stage) => (
          <section key={stage.stageId} className="flex flex-col gap-4">
            <h3 className="font-strong">
              {stage.kind === 'preliminary' ? 'Preliminary' : 'Elimination'} ·{' '}
              {stage.place === 'online' ? 'Online' : 'In person'} ·{' '}
              {stage.timing === 'live' ? 'Live' : 'Windowed'}
              {stage.division ? ` · ${stage.division}` : ''}
            </h3>
            {stage.rounds.map((round) => (
              <details key={round.tabRoundId}>
                <summary className="cursor-pointer font-strong">
                  {round.title}
                </summary>
                <div className="flex flex-col gap-4 py-3">
                  <ActionButton action={round.open} />
                  {round.save ? (
                    render(
                      round.save,
                      <RoundFields
                        name={round.name}
                        selected={round.resolution}
                        choices={round.save.command.target.resolutionChoices}
                        released={
                          round.save.command.target.lockedResolution !==
                          undefined
                        }
                      />,
                    )
                  ) : (
                    <p>Draw published.</p>
                  )}
                  {round.place
                    ? render(
                        round.place,
                        <label className={fieldClass}>
                          <span className={labelClass}>Time slot</span>
                          <select
                            name="timeSlotId"
                            className={controlClass}
                            defaultValue={round.timeSlotId ?? ''}
                          >
                            <option value="">No time slot</option>
                            {round.place.command.target.timeSlots.map(
                              (slot) => (
                                <option
                                  key={slot.timeSlotId}
                                  value={slot.timeSlotId}
                                >
                                  {slot.name}
                                </option>
                              ),
                            )}
                          </select>
                        </label>,
                      )
                    : null}
                </div>
              </details>
            ))}
            {render(
              stage.add,
              <RoundFields
                name={null}
                selected=""
                choices={stage.add.command.target.resolutionChoices}
              />,
            )}
          </section>
        ))}
        <details>
          <summary className="cursor-pointer font-strong">Add stage</summary>
          <div className="py-3">{render(editor.addStage, <StageFields />)}</div>
        </details>
      </div>
    </ListCard>
  );
}

/** A tournament's events, its schedule and one addressed event's authoring controls. */
export function EventsSchedule({
  rail,
  board,
  bind,
}: {
  readonly rail: TimelineRail;
  readonly board: Board;
  readonly bind: (command: EventFormContext) => ReplayCommandAction;
}) {
  const render: Render = (action, fields) => (
    <CommandControl action={action} bind={bind}>
      {fields}
    </CommandControl>
  );
  const aside = board.aside;
  const event = aside?.kind === 'edit' ? aside.event : null;
  const asideTitle = aside?.kind === 'create' ? 'Add event' : event?.name;
  return (
    <HostShell
      rail={rail}
      current="events"
      {...(aside && asideTitle
        ? {
            asideLabel: asideTitle,
            aside: (
              <div className="flex flex-col gap-4">
                <h2 className="font-display text-xl font-bold">{asideTitle}</h2>
                {render(
                  aside.save,
                  <EventMetadataFields
                    event={event}
                    pins={
                      aside.kind === 'create'
                        ? aside.save.command.target.pinOptions
                        : []
                    }
                  />,
                )}
                {aside.kind === 'edit' ? (
                  <>
                    {aside.links.map((action) => (
                      <ActionButton key={action.label} action={action} />
                    ))}
                    {render(aside.remove)}
                  </>
                ) : null}
                <ActionButton action={board.cancel} />
              </div>
            ),
          }
        : {})}
    >
      <PageHeader
        title="Events and schedule"
        lede={board.lede}
        actions={board.actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      />
      <ListCard>
        {board.groups.map((group) => (
          <section key={group.events[0]?.slug ?? group.name}>
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
                  tone={event.slug === board.selectedEventId ? 'held' : 'plain'}
                  current={event.slug === board.selectedEventId}
                />
              ))}
            </ul>
          </section>
        ))}
      </ListCard>
      {board.editor ? <Editor editor={board.editor} render={render} /> : null}
      {board.openTournament ? (
        <ListCard>
          <div className="p-4">{render(board.openTournament)}</div>
        </ListCard>
      ) : null}
      <ListCard>
        <ListHeading>Time slots</ListHeading>
        <div className="flex flex-col gap-5 p-4">
          {board.slots.map((slot) => (
            <details key={slot.timeSlotId}>
              <summary className="cursor-pointer font-strong">
                {slot.name} · {slot.startsAt}
              </summary>
              <div className="flex flex-col gap-4 py-3">
                <ActionButton action={slot.open} />
                {render(
                  slot.save,
                  <SlotFields name={slot.name} startsAt={slot.startsAt} />,
                )}
                {render(slot.remove)}
              </div>
            </details>
          ))}
          <details>
            <summary className="cursor-pointer font-strong">
              Add time slot
            </summary>
            <div className="py-3">
              {render(board.addSlot, <SlotFields name="" startsAt="" />)}
            </div>
          </details>
        </div>
      </ListCard>
      <ListCard>
        <ListHeading>Resolution sources</ListHeading>
        <ul>
          {board.pools.map((pool) => (
            <ListRow
              key={pool.resolutionPoolId}
              title={pool.name}
              detail={`${pool.size} active resolutions`}
            />
          ))}
        </ul>
        <details className="p-4">
          <summary className="cursor-pointer font-strong">
            Add resolution
          </summary>
          <div className="py-3">
            {render(
              board.addResolution,
              <ResolutionFields
                pools={board.addResolution.command.target.pools.map(
                  ({ poolId, name }) => ({ resolutionPoolId: poolId, name }),
                )}
              />,
            )}
          </div>
        </details>
      </ListCard>
    </HostShell>
  );
}
