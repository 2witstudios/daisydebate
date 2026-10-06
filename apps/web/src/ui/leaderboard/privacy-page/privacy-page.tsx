import Link from 'next/link';
import {
  privacySections,
  privacySettingRows,
  type PrivacyRow,
} from '../../../features/leaderboard/privacy';
import { getPreferences } from '../../../features/settings/preferences';
import { Badge } from '../../components/badge/badge';
import { Icon } from '../../components/icon/icon';

const card = 'flex flex-col gap-4 rounded-lg bg-surface p-5 shadow-1';

function Row({ row }: { readonly row: PrivacyRow }) {
  return (
    <li className="flex items-start justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col">
        <span className="font-strong">{row.title}</span>
        <span className="text-sm text-ink-muted">{row.where}</span>
        {row.note ? (
          <span className="text-sm text-ink-faint">{row.note}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone="neutral">{row.tag}</Badge>
        {row.visibility ? <Badge tone="accent">{row.visibility}</Badge> : null}
      </div>
    </li>
  );
}

/** The ladder setting as the account has it, changed in Settings. */
function YourSettings() {
  const rows = privacySettingRows(getPreferences().privacy);
  return (
    <section className={card}>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">Your privacy settings</h2>
      </div>
      <p className="text-sm text-ink-muted">
        Where you control what the ladder shows.
      </p>
      <ul className="flex flex-col gap-4">
        {rows.map((setting) => (
          <li
            key={setting.id}
            className="flex items-start justify-between gap-4"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-strong">{setting.label}</span>
              <span className="text-sm text-ink-muted">{setting.help}</span>
            </span>
            <Badge tone={setting.on ? 'accent' : 'neutral'}>
              {setting.on ? 'On' : 'Off'}
            </Badge>
          </li>
        ))}
      </ul>
      <Link href="/settings#privacy" className="text-sm font-bold">
        Change in settings
      </Link>
    </section>
  );
}

/** What another debater sees of you. */
function Preview() {
  return (
    <section className={card}>
      <h2 className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
        What another debater sees of you
      </h2>
      <p className="flex items-center gap-3">
        <Icon name="person" size={24} />
        <span className="flex flex-col">
          <span className="font-strong">@your-username</span>
          <span className="text-sm text-ink-muted tabular-nums">
            #63 · 1538 · 19–12
          </span>
        </span>
      </p>
    </section>
  );
}

/** What the ladder shows, what stays private, and what is hidden on purpose. */
export function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        Leaderboard privacy
      </h1>
      <div className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
        {privacySections.map((section) => (
          <section key={section.title} className={card}>
            <h2 className="text-lg font-bold">{section.title}</h2>
            <p className="text-sm text-ink-muted">{section.lede}</p>
            <ul className="flex flex-col gap-3">
              {section.rows.map((row) => (
                <Row key={row.title} row={row} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        <YourSettings />
        <Preview />
      </div>
    </div>
  );
}
