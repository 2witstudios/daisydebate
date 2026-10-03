import Link from 'next/link';
import type { HostScreen } from '../../../features/ranked/drive-host';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import { controlClass } from '../../lobby/filter-bar/filter-bar-class';
import { buttonClass } from '../../components/button/button-class';
import { linkButtonClass } from '../ranked-card/link-button-class';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';

const note =
  'flex gap-3 rounded-xl border border-border bg-surface-raised p-4 text-base text-ink-muted';

/**
 * The host form: a GET to the same route. The band select applies at once
 * once hydrated; Post table moves to the mock confirmation. Nothing typed
 * rides in the address: a ranked table has only the band to choose.
 */
export function HostTable({ screen }: { readonly screen: HostScreen }) {
  return (
    <RankedCard>
      <h1 className={cn(cardTitleClass, 'text-2xl')}>Host a ranked table</h1>
      <p className="text-md text-ink-muted">
        Post an open table for anyone in your rating band. Hosting does not use
        your search.
      </p>
      <AutoSubmitForm
        action={screen.formAction}
        aria-label="Host a ranked table"
        className="flex flex-col gap-4"
      >
        <p className="text-base text-ink-muted">
          Your rating: <strong className="text-ink">{screen.ratingText}</strong>
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="host-band" className="text-base font-strong">
            Who can take the open seat
          </label>
          <select
            id="host-band"
            name="band"
            defaultValue={String(screen.band)}
            className={controlClass}
          >
            {screen.bandOptions.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-sm text-ink-muted">{screen.seatText}</p>
        </div>
        <div className={note}>
          <span className="mt-1 text-accent">
            <Icon name="book" size={18} />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-md font-bold text-ink">Standard rules</h2>
            <p>
              Ranked tables cannot customise the rules. Want custom rules?{' '}
              <Link href={screen.lobbyHref}>
                Host a casual table in the lobby.
              </Link>
            </p>
          </div>
        </div>
        <div className={note}>
          <span className="mt-1 text-accent">
            <Icon name="gavel" size={18} />
          </span>
          <p>
            Daisy assigns the judge when the debate starts. You cannot choose
            one.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={screen.cancelHref}
            className={linkButtonClass('secondary', 'flex-1')}
          >
            Cancel
          </Link>
          <button
            type="submit"
            name="step"
            value="posted"
            className={cn(buttonClass('primary'), 'flex-2')}
          >
            Post table
          </button>
        </div>
        <p className="text-sm text-ink-muted">
          Posting opens a room in the lobby. You take your seat there, and the
          other seat stays open until a player in the band takes it.
        </p>
      </AutoSubmitForm>
    </RankedCard>
  );
}
