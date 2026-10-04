import Link from 'next/link';
import { buttonClass } from '../../components/button/button-class';
import { PrepIcon } from '../prep-icon/prep-icon';

export type NotFoundPanelProps = {
  /** "card", "brief", "case" or "team". */
  readonly what: string;
  readonly backHref: string;
  readonly backLabel: string;
};

/** An id that matches nothing the owner can open. */
export function NotFoundPanel({
  what,
  backHref,
  backLabel,
}: NotFoundPanelProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col items-center gap-3 px-6 py-12 text-center">
      <PrepIcon name="search" size={28} className="text-ink-faint" />
      <h1 className="font-display text-2xl leading-tight font-bold">{`We can’t find that ${what}`}</h1>
      <Link
        href={backHref}
        className={`${buttonClass('secondary')} no-underline hover:no-underline`}
      >
        {backLabel}
      </Link>
    </div>
  );
}
