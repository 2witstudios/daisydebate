import type { TabAction } from '../../../features/tab/action';
import type { EventSwitch } from '../../../features/tab/setup';
import { WalkLink as Link } from '../walk/walk-link';
import { buttonClass } from '../../components/button/button-class';
import { UnavailableControl } from '../action-control/unavailable-control';

const itemClass =
  'block rounded-sm px-3 py-2 whitespace-nowrap text-ink no-underline hover:bg-surface hover:no-underline';

function Other({ event }: { readonly event: TabAction }) {
  return event.kind === 'unavailable' ? (
    <UnavailableControl label={event.label} className={itemClass}>
      {event.label}
    </UnavailableControl>
  ) : (
    <Link href={event.href} className={itemClass}>
      {event.label}
    </Link>
  );
}

/**
 * Which event a host screen shows. A native disclosure, so it opens without
 * script; an event with no screen of its own yet answers as a sample action.
 */
export function EventSwitcher({ event }: { readonly event: EventSwitch }) {
  return (
    // Keyed by event, so switching to another event arrives closed.
    <details key={event.current} className="relative self-start">
      <summary
        className={`${buttonClass('secondary')} list-none bg-surface-raised`}
      >
        {event.current} · {event.position}
      </summary>
      <ul className="absolute z-1 mt-1 flex min-w-full flex-col rounded-lg border border-border bg-surface-raised p-1 shadow-2">
        {event.others.map((other) => (
          <li key={other.label}>
            <Other event={other} />
          </li>
        ))}
      </ul>
    </details>
  );
}
