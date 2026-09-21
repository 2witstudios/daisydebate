'use client';

import Link from 'next/link';
import { SearchInput } from '../../../../components/search-input/search-input';
import { IconButton } from '../../../../components/icon-button/icon-button';
import { Avatar } from '../../../../components/avatar/avatar';
import { PresenceDot } from '../../../../components/presence-dot/presence-dot';
import { Stat } from '../../../../components/stat/stat';
import { Icon } from '../../../../components/icon/icon';
import { Tier } from '../../../../types/tier/tier';
import { useUiState } from '../../../../store/store';
import { avatarSrc } from '../../../../assets';

/** The Daisy mark: eight petals around a solid disc. Filled, not stroked. */
function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <g fill="currentColor">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <ellipse
            key={angle}
            cx="12"
            cy="5.1"
            rx="2.3"
            ry="3.9"
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </g>
      <circle cx="12" cy="12" r="2.4" fill="var(--accent-text)" />
    </svg>
  );
}

export function Topbar() {
  // Selectors return primitives or stable references — never fresh literals.
  const notificationsCount = useUiState(
    (state) => state.resources.notificationsCount,
  );
  const viewer = useUiState((state) => state.resources.viewer);
  return (
    <header className="flex h-topbar items-center gap-6 px-6 max-compact:gap-4 max-compact:px-4">
      <Link
        href="/"
        className="flex items-center gap-3 text-ink no-underline hover:no-underline"
      >
        <span
          className="inline-flex size-shell-logo items-center justify-center rounded-sm bg-accent text-accent-ink"
          aria-hidden="true"
        >
          <BrandMark />
        </span>
        <span className="font-display text-xl leading-shell-brand font-semibold tracking-tight max-narrow:hidden">
          Daisy
        </span>
        <span className="flex flex-col border-l border-border pl-2 text-shell-tagline leading-shell-tagline font-strong tracking-widest text-ink-faint uppercase max-rail:hidden">
          Sharper minds.
          <br />A brighter world.
        </span>
      </Link>
      <div className="flex flex-1 justify-center">
        <SearchInput />
      </div>
      <div className="flex items-center gap-4">
        <span className="relative inline-flex">
          <IconButton name="bell" label="Notifications" />
          {notificationsCount > 0 ? (
            <span
              className="absolute -top-shell-hair -right-shell-hair h-shell-count min-w-shell-count rounded-round bg-live px-1 text-center text-shell-count leading-shell-count font-black text-ink-on-live"
              aria-hidden="true"
            >
              {notificationsCount}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-3 rounded-md bg-transparent px-3 py-2 text-ink hover:bg-surface-overlay"
        >
          <Avatar name={viewer.name} src={avatarSrc(viewer.name)} size="md" />
          <span className="flex flex-col items-start gap-shell-hair max-compact:hidden">
            <span className="inline-flex items-center gap-2">
              <span className="text-sm leading-tight font-bold">
                {viewer.name}
              </span>
              <PresenceDot presence="online" />
            </span>
            <span className="inline-flex items-center gap-3">
              <Stat icon="chart" value={viewer.rating} />
              <span className="inline-flex items-center gap-1 text-xs font-black tracking-wide text-tier-diamond">
                <Icon name="gem" size={13} />
                {Tier.label[viewer.tier]}
              </span>
            </span>
          </span>
          <Icon name="chevronDown" size={16} className="text-ink-faint" />
        </button>
      </div>
    </header>
  );
}
