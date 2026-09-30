import Link from 'next/link';
import type { RankedRule } from '../../../features/ranked/rules';
import { Icon } from '../../components/icon/icon';
import { linkButtonClass } from '../ranked-card/link-button-class';

export type RulesDrawerProps = {
  readonly rules: readonly RankedRule[];
  readonly closeHref: string;
};

/**
 * The rules, open over the hub. It is a URL state (`?rules=1`), so it opens
 * and closes with plain links and a reload keeps it.
 */
export function RulesDrawer({ rules, closeHref }: RulesDrawerProps) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <Link
        href={closeHref}
        aria-label="Close the rules"
        tabIndex={-1}
        className="absolute inset-0 bg-scrim/60"
      />
      <aside
        aria-labelledby="ranked-rules-title"
        className="relative flex h-full w-full max-w-auth-panel flex-col gap-5 overflow-y-auto bg-surface-raised p-6 shadow-3"
      >
        <header className="flex items-center justify-between gap-3">
          <h2
            id="ranked-rules-title"
            className="font-display text-xl font-bold tracking-tight"
          >
            Ranked rules
          </h2>
          <Link href={closeHref} className={linkButtonClass('ghost')}>
            Close
          </Link>
        </header>
        <ul className="flex flex-col gap-5">
          {rules.map(({ id, icon, title, body }) => (
            <li key={id} className="flex gap-3">
              <span className="mt-1 text-accent">
                <Icon name={icon} size={18} />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-md font-bold">{title}</h3>
                <p className="text-base text-ink-muted">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <Link href={closeHref} className={linkButtonClass('primary', 'w-full')}>
          Got it
        </Link>
      </aside>
    </div>
  );
}
