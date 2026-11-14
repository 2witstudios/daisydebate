import Link from 'next/link';
import type { CreateRoom as Read } from '../../../features/tab/league';
import { Button } from '../../components/button/button';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ChoiceField } from '../choice-field/choice-field';
import { ListCard, ListHeading } from '../list-card/list-card';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';
import { SettingRow } from '../setting-row/setting-row';

const idOf = (label: string) =>
  `room-${label.toLowerCase().replaceAll(' ', '-')}`;

/**
 * The create-room form of a standing lobby, built from the template the Room
 * follows: what the league enforces is shown locked, and the template's
 * defaults are prefilled and may be changed.
 */
export function CreateRoom({
  room,
  submit,
}: {
  readonly room: Read;
  readonly submit: SampleSubmit;
}) {
  return (
    <ReadingPage>
      <Link
        href={room.lobby.href}
        className="self-start font-strong text-ink underline"
      >
        {room.lobby.name}
      </Link>
      <PageHeader title="Create a room" />
      <SampleForm
        action={submit(room.open.label)}
        label="Create a room"
        className="flex flex-col gap-5"
      >
        <div className={fieldClass}>
          <label htmlFor="room-title" className={labelClass}>
            Room name
          </label>
          <input
            id="room-title"
            name="title"
            type="text"
            maxLength={80}
            defaultValue={room.name}
            className={controlClass}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className={`mb-2 ${labelClass}`}>League template</legend>
          <div className="grid grid-cols-3 gap-2">
            {room.templates.map((template) => (
              <label
                key={template.name}
                className="flex cursor-pointer flex-col gap-1 rounded-md border border-border bg-surface-raised p-3 has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="template"
                    value={template.name}
                    defaultChecked={template.name === room.template}
                    className="accent-accent"
                  />
                  <strong className="font-strong">{template.name}</strong>
                </span>
                <span className="text-sm text-ink-muted">
                  {template.detail}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <ListCard label={`Set by ${room.lockedBy}`}>
          <ListHeading>Set by {room.lockedBy} · locked</ListHeading>
          <ul>
            {room.locked.map((setting) => (
              <SettingRow key={setting.label} setting={setting} grouped />
            ))}
          </ul>
        </ListCard>
        <div className="grid grid-cols-2 gap-3 max-narrow:grid-cols-1">
          {room.defaults.map((choice) => (
            <ChoiceField
              key={choice.label}
              id={idOf(choice.label)}
              choice={choice}
            />
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            name="ranked"
            defaultChecked={room.ranked.checked}
            className="accent-accent"
          />
          <span>
            <strong className="font-strong">{room.ranked.label}</strong>
            <span className="text-ink-muted"> · {room.ranked.detail}</span>
          </span>
        </label>
        <Button type="submit">{room.open.label}</Button>
      </SampleForm>
    </ReadingPage>
  );
}
