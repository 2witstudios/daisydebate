import {
  privacySections,
  settingsProposal,
  type PrivacyRow,
} from '../../../features/leaderboard/privacy';
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
        {row.proposed ? <Badge tone="gold">proposed</Badge> : null}
      </div>
    </li>
  );
}

/**
 * The toggles are proposals: they render in the proposed state, disabled,
 * and say why. A settings backend and an owner decision come first.
 */
function SettingsProposal() {
  return (
    <section className={card}>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">Privacy settings</h2>
        <Badge tone="gold">Proposal</Badge>
      </div>
      <p className="text-sm text-ink-muted">
        Where a debater controls what the ladder shows.
      </p>
      <ul className="flex flex-col gap-4">
        {settingsProposal.map((setting) => (
          <li
            key={setting.id}
            className="flex items-start justify-between gap-4"
          >
            <label htmlFor={setting.id} className="flex min-w-0 flex-col">
              <span className="font-strong">{setting.label}</span>
              <span className="text-sm text-ink-muted">{setting.help}</span>
              <span className="text-sm text-ink-faint">
                {setting.inertReason}
              </span>
            </label>
            <input
              id={setting.id}
              type="checkbox"
              role="switch"
              checked={setting.on}
              disabled
              readOnly
              className="mt-1 size-5 accent-accent"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What another debater sees of you: a sample card. */
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
            Bloom · #63 · 1538 · 19–12
          </span>
        </span>
      </p>
      <p className="text-sm text-ink-muted">
        No email, no region unless you chose it, no judge information.
      </p>
    </section>
  );
}

/** What the ladder shows, what stays private, and what is hidden on purpose. */
export function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          Leaderboard privacy
        </h1>
        <p className="text-base text-ink-muted">
          What the ladder shows, what stays private, and what is hidden on
          purpose. Categories follow ADR 0036.
        </p>
      </header>
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
        <SettingsProposal />
        <Preview />
      </div>
    </div>
  );
}
