import type { CreateRoomDraft } from '../../../features/rooms/create-room-draft';
import {
  judgeSeatField,
  moderatorSeatField,
  sideSeatField,
  speakerSeatField,
} from '../../../features/rooms/draft-seat-fields';
import { controlClass } from '../../components/form-field/form-field-class';

type SeatInputProps = {
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
};

/**
 * One count per seat the format seats: each declared side's debaters, or an
 * unsided format's speakers, then judges, and the moderator of a format
 * that seats one. A ranked room
 * admits one judge (ranked admission's one-on-one shape).
 */
export function seatInputs(draft: CreateRoomDraft): readonly SeatInputProps[] {
  const { sides } = draft.definition;
  return [
    ...sides.map((side) => ({
      name: sideSeatField(side.key),
      label: `${side.label} debaters`,
      min: 1,
      max: 255,
    })),
    ...(sides.length === 0
      ? [{ name: speakerSeatField, label: 'Speakers', min: 1, max: 255 }]
      : []),
    {
      name: judgeSeatField,
      label: 'Judges',
      min: 0,
      max: draft.ranked ? 1 : 255,
    },
    ...(draft.definition.seats.moderators > 0
      ? [{ name: moderatorSeatField, label: 'Moderators', min: 0, max: 1 }]
      : []),
  ];
}

export function SeatInput({
  name,
  label,
  min,
  max,
  values,
  change,
}: SeatInputProps & {
  readonly values: Readonly<Record<string, string>>;
  readonly change: (name: string, value: string) => void;
}) {
  return (
    <label className="create-room-field">
      <span>{label}</span>
      <input
        className={controlClass}
        type="number"
        name={name}
        value={values[name]}
        min={min}
        max={max}
        onChange={(event) => change(name, event.target.value)}
        required
      />
    </label>
  );
}
