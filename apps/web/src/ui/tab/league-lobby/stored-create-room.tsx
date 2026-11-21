'use client';
import { useId, useState } from 'react';
import type { StandingRoomView } from '../../../features/tab/standing-room-view';
import { standingRoomUnavailableReason } from '../../../features/tab/standing-room-view';
import {
  initialStandingRoom,
  standingRoomUnavailable,
  type StandingRoomState,
} from '../../../features/tab/standing-room-form';
import { formFields, destinationOf } from '../../../features/forms/form-state';
import { tabRoutes } from '../../../features/tab/routes';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { Button } from '../../components/button/button';
import {
  controlClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { BackButton } from '../action-control/action-control';
import { ListCard, ListHeading } from '../list-card/list-card';
import { SettingRow } from '../setting-row/setting-row';
import { SearchForm } from '../../components/search-form/search-form';
/** Native creation preserves the exact displayed pins/config and submitted pool wording on uncertain retry. */
export function StoredCreateRoom({
  view,
  action,
}: {
  readonly view: StandingRoomView;
  readonly action: FormAction<StandingRoomState>;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialStandingRoom(view.creation),
    standingRoomUnavailable,
  );
  const fields = formFields(state);
  const [chosen, setChosen] = useState(fields.values['resolution'] ?? '');
  const selected =
    state.kind === 'unacknowledged'
      ? (fields.values['resolution'] ?? '')
      : chosen;
  const policy = view.creation.resolutionChoicePolicy;
  const pool = policy.choices.find((row) => row.id === selected);
  const next = destinationOf(state);
  useMovedOn(next);
  const notice = useId();
  useFocusAfterAnswer(
    state,
    fields.error || state.kind === 'unacknowledged' ? notice : undefined,
    !pending,
  );
  const unavailable = standingRoomUnavailableReason(view.creation);
  const disabled = pending || next !== undefined;
  const frozen = state.kind === 'unacknowledged';
  const roomAddress = tabRoutes.newLeagueRoom(view.leagueHandle);
  return (
    <ReadingPage>
      <BackButton
        href={tabRoutes.league(view.leagueHandle)}
        label={view.lobby.name}
      />
      <PageHeader title="Create a room" />
      <SearchForm
        action={roomAddress}
        aria-label="Choose a league template"
        className="flex flex-wrap items-end gap-3"
      >
        <label className={labelClass}>
          League template
          <select
            name="template"
            className={controlClass}
            defaultValue={view.templateId}
            disabled={pending || frozen}
          >
            {view.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · {template.detail}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" disabled={pending || frozen}>
          Use template
        </Button>
      </SearchForm>
      <form
        action={submit}
        aria-label="Create a room"
        aria-busy={pending}
        className="flex flex-col gap-5"
      >
        {frozen
          ? Object.entries(fields.values).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))
          : null}
        <fieldset disabled={disabled || frozen} className="flex flex-col gap-5">
          <label className={labelClass}>
            Room name
            <input
              name="title"
              className={controlClass}
              maxLength={80}
              required
              defaultValue={fields.values['title']}
              key={`title-${fields.values['title']}`}
            />
          </label>
          <ListCard label="Locked settings">
            <ListHeading>Set by the league · locked</ListHeading>
            <ul>
              {view.locked.map((setting) => (
                <SettingRow key={setting.label} setting={setting} grouped />
              ))}
            </ul>
          </ListCard>
          {view.defaults.length ? (
            <ListCard label="Room defaults">
              <ListHeading>Room defaults</ListHeading>
              <ul>
                {view.defaults.map((setting) => (
                  <SettingRow key={setting.label} setting={setting} grouped />
                ))}
              </ul>
            </ListCard>
          ) : null}
          <label className={labelClass}>
            Who can see the room
            {view.creation.visibility.locked ? (
              <>
                <input
                  type="hidden"
                  name="visibility"
                  value={view.creation.visibility.value}
                />
                <span>
                  {view.creation.visibility.value === 'unlisted'
                    ? 'Unlisted'
                    : 'Public'}{' '}
                  · locked
                </span>
              </>
            ) : (
              <select
                name="visibility"
                className={controlClass}
                defaultValue={fields.values['visibility']}
                key={`visibility-${fields.values['visibility']}`}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
              </select>
            )}
          </label>
          <label className={labelClass}>
            Recording
            {view.creation.recording.locked ? (
              <>
                <input
                  type="hidden"
                  name="recording"
                  value={view.creation.recording.value}
                />
                <span>
                  {view.creation.recording.value === 'on'
                    ? 'On · officials'
                    : 'Off'}{' '}
                  · locked
                </span>
              </>
            ) : (
              <select
                name="recording"
                className={controlClass}
                defaultValue={fields.values['recording']}
                key={`recording-${fields.values['recording']}`}
              >
                <option value="off">Off</option>
                <option value="on">On · officials</option>
              </select>
            )}
          </label>
          {policy.method === 'fixed' ? (
            <>
              <label className={labelClass}>
                Resolution
                <select
                  className={controlClass}
                  name="resolution"
                  value={selected}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {policy.choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.text}
                    </option>
                  ))}
                  {policy.ownText ? (
                    <option value="custom">My own resolution</option>
                  ) : null}
                </select>
              </label>
              {selected === 'custom' ? (
                <label className={labelClass}>
                  Resolution text
                  <textarea
                    name="topic"
                    className={controlClass}
                    maxLength={300}
                    required
                    defaultValue={
                      fields.values['resolution'] === 'custom'
                        ? fields.values['topic']
                        : ''
                    }
                    key={`topic-${fields.values['topic']}`}
                  />
                </label>
              ) : (
                <input type="hidden" name="topic" value={pool?.text ?? ''} />
              )}
            </>
          ) : (
            <>
              <input type="hidden" name="resolution" value="strike" />
              <input type="hidden" name="topic" value="" />
              <p className="text-sm text-ink-muted">
                {policy.method === 'strike'
                  ? 'Strike from the league pool.'
                  : 'Draw from the league pool.'}
              </p>
            </>
          )}
          <p className="text-sm text-ink-muted">
            {view.creation.rating.kind === 'rated'
              ? 'Rated on the league ladder'
              : view.creation.rating.kind === 'unrated'
                ? 'Unrated'
                : ''}
          </p>
        </fieldset>
        {unavailable ? (
          <p role="status" className="text-sm text-ink-muted">
            {unavailable}
          </p>
        ) : null}
        <Button type="submit" disabled={disabled || !!unavailable}>
          {frozen ? 'Retry create room' : 'Create room'}
        </Button>
        {fields.error || frozen ? (
          <p
            id={notice}
            tabIndex={-1}
            role="status"
            className="text-sm text-ink-muted"
          >
            {frozen
              ? 'The answer was lost. Retry the same room, or reload to check whether it was created.'
              : fields.error}
          </p>
        ) : null}
      </form>
    </ReadingPage>
  );
}
