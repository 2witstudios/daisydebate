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

/**
 * The create-room form of a standing lobby, built from the template the Room
 * follows: what the template enforces is shown locked, and its defaults are
 * prefilled and may be changed.
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
      <PageHeader title="New room" />
      <SampleForm
        action={submit(room.open.label)}
        label="New room"
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
            className={controlClass}
          />
        </div>
        <ChoiceField id="room-template" choice={room.template} />
        <ListCard>
          <ListHeading>Set by the template</ListHeading>
          <ul>
            {room.locked.map((setting) => (
              <SettingRow key={setting.label} setting={setting} />
            ))}
          </ul>
        </ListCard>
        {room.defaults.map((choice) => (
          <ChoiceField
            key={choice.label}
            id={`room-${choice.label.toLowerCase().replaceAll(' ', '-')}`}
            choice={choice}
          />
        ))}
        <Button type="submit">{room.open.label}</Button>
      </SampleForm>
    </ReadingPage>
  );
}
