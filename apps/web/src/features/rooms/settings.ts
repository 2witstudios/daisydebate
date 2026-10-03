import { accept, field, refuse, type Parsed } from '../mock-form/form';
import type { JudgeKind } from './state';

export const speechChoices = [2, 3, 4, 5, 8] as const;
export const prepChoices = [0, 1, 2, 3] as const;

export type CreateRoom = {
  readonly name: string;
  readonly speech: number;
  readonly prep: number;
  readonly judge: JudgeKind;
};

const inChoices = (
  value: string,
  choices: readonly number[],
): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && choices.includes(number) ? number : null;
};

/** The speech and prep lengths a host may choose, read from a posted form. */
export function parseTimings(
  form: FormData,
): Parsed<{ speech: number; prep: number }> {
  const speech = inChoices(field(form, 'speech'), speechChoices);
  if (speech === null)
    return refuse('Choose a speech length of 2, 3, 4, 5 or 8 minutes.');
  const prep = inChoices(field(form, 'prep'), prepChoices);
  if (prep === null)
    return refuse('Choose a prep time of 0, 1, 2 or 3 minutes.');
  return accept({ speech, prep });
}

/** A new practice room, read from the posted form. */
export function parseCreateRoom(form: FormData): Parsed<CreateRoom> {
  const name = field(form, 'name');
  if (name.length > 60) return refuse('A room name is up to 60 characters.');
  if (field(form, 'format') !== 'foundation') return refuse('Choose a format.');
  const timings = parseTimings(form);
  if (!timings.ok) return timings;
  const judge = field(form, 'judge');
  if (judge !== 'person' && judge !== 'ai')
    return refuse('Choose who judges: a person or the AI judge.');
  return accept({ name, ...timings.value, judge });
}

/**
 * Where a created room opens. There is no backend to keep what was typed, so
 * the page for the judge choice stands in for the room; the room name and
 * timings are not carried in the address.
 */
export const createdRoomPath = (room: CreateRoom): string =>
  room.judge === 'ai' ? '/rooms/created-ai' : '/rooms/created';
