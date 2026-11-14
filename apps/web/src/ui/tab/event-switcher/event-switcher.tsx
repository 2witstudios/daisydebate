import type { EventSwitch } from '../../../features/tab/setup';
import { buttonClass } from '../../components/button/button-class';
import { SampleAction } from '../../components/sample-action/sample-action';

/**
 * Which event a host screen shows. A native disclosure, so it opens without
 * script; the other events answer as sample actions until they have reads.
 */
export function EventSwitcher({ event }: { readonly event: EventSwitch }) {
  return (
    <details className="relative self-start">
      <summary
        className={`${buttonClass('secondary')} list-none bg-surface-raised`}
      >
        {event.current} · {event.position}
      </summary>
      <ul className="absolute z-1 mt-1 flex min-w-full flex-col rounded-lg border border-border bg-surface-raised p-1 shadow-2">
        {event.others.map((name) => (
          <li key={name}>
            <SampleAction
              label={name}
              className="block rounded-sm px-3 py-2 whitespace-nowrap text-ink hover:bg-surface"
            >
              {name}
            </SampleAction>
          </li>
        ))}
      </ul>
    </details>
  );
}
