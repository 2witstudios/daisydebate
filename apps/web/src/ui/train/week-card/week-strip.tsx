import { Icon } from '../../components/icon/icon';
import { dayClass } from './week-class';

const days = [
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
  ['S', 'Sunday'],
] as const;

/** Seven days, Monday first; trained days carry a check. */
export function WeekStrip({
  trained,
}: {
  readonly trained: readonly boolean[];
}) {
  return (
    <ol className="flex justify-between gap-1">
      {days.map(([letter, name], index) => {
        const did = trained[index] === true;
        return (
          <li key={name} className="flex flex-col items-center gap-2">
            <span className="text-xs text-ink-faint" aria-hidden="true">
              {letter}
            </span>
            <span className={dayClass(did)}>
              {did ? <Icon name="check" size={14} /> : null}
              <span className="sr-only">
                {`${name}: ${did ? 'trained' : 'rest day'}`}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
