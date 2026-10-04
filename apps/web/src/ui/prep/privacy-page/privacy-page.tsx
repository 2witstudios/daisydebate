import {
  privacyPromises,
  privacyRows,
  whoSeesInDebate,
} from '../../../features/prep/privacy';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { PrepIcon } from '../prep-icon/prep-icon';

const columns = ['What', 'Who can see it', 'Retention and erasure'] as const;

/** What stays private: three promises and who can see what. */
export function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:px-4">
      <Breadcrumb
        crumbs={[{ label: 'Prep', href: '/prep' }, { label: 'Privacy' }]}
      />
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        What stays private
      </h1>
      <ul className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
        {privacyPromises.map((promise) => (
          <li
            key={promise.title}
            className="flex flex-col gap-2 rounded-lg bg-surface p-5 shadow-1"
          >
            <PrepIcon name={promise.symbol} size={22} className="text-accent" />
            <h2 className="text-md font-bold">{promise.title}</h2>
            <p className="text-sm text-ink-muted">{promise.body}</p>
          </li>
        ))}
      </ul>
      <section aria-labelledby="who-heading" className="flex flex-col gap-3">
        <h2 id="who-heading" className="text-lg font-bold">
          What each person sees in a debate
        </h2>
        <ul className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
          {whoSeesInDebate.map((entry) => (
            <li
              key={entry.who}
              className="flex flex-col gap-2 rounded-lg bg-surface p-5 shadow-1"
            >
              <h3 className="text-base font-bold">{entry.who}</h3>
              <p
                className={`flex items-center gap-2 rounded-md border px-3 py-3 text-sm ${
                  entry.hasPanel
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-dashed border-border-strong text-ink-faint'
                }`}
              >
                {entry.hasPanel ? <PrepIcon name="lock" size={14} /> : null}
                {entry.hasPanel ? 'Your prep' : 'No prep panel'}
              </p>
              <p className="text-sm text-ink-muted">{entry.sees}</p>
            </li>
          ))}
        </ul>
      </section>
      <div className="overflow-x-auto rounded-lg bg-surface shadow-1">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Who can see each kind of prep, and how long it is kept
          </caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-4 py-3 text-xs font-bold tracking-wider text-ink-muted uppercase"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {privacyRows.map(([what, who, keep]) => (
              <tr key={what} className="border-t border-border align-top">
                <th scope="row" className="px-4 py-3 text-base font-strong">
                  {what}
                </th>
                <td className="px-4 py-3 text-ink-muted">{who}</td>
                <td className="px-4 py-3 text-ink-muted">{keep}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
