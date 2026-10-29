import {
  acknowledgedAnchors,
  readAuditPage,
  verifyStoredChain,
} from '../../audit/store';
import { chainBadge } from '../../audit/badge';
import {
  reconcileOpenCommands,
  RECONCILE_BATCH,
} from '../../features/accounts/commands';
import { openCommands } from '../../features/accounts/store';
import { reconcileAction } from '../accounts/actions';
import { requireOperator } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';
import { NotPermitted, OperatorNav } from '../operator-nav';
import type { AuditRow } from '../../audit/chain';
import type { PendingCommand } from '../../features/accounts/store';

export const dynamic = 'force-dynamic';
const pageSize = 50;

/** The commands still open, with the Reconcile form (plain POST). */
function UnknownCommands({
  commands,
}: {
  readonly commands: readonly PendingCommand[];
}) {
  if (commands.length === 0) return <p>No command has an unknown outcome.</p>;
  return (
    <form action={reconcileAction}>
      <input type="hidden" name="back" value="audit" />
      <ul data-testid="unknown-commands">
        {commands.map((command) => (
          <li key={command.commandId}>
            {command.commandId}: {command.desiredState} for{' '}
            {command.targetUserId} at revision {command.expectedRevision}
          </li>
        ))}
      </ul>
      <button type="submit">Reconcile</button>
    </form>
  );
}

function EventsTable({ rows }: { readonly rows: readonly AuditRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="numeric">Seq</th>
            <th>When (UTC)</th>
            <th>Event</th>
            <th>Command</th>
            <th>Outcome</th>
            <th>Detail</th>
            <th>Operator</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.seq}>
              <td className="numeric">{row.seq}</td>
              <td className="muted">{row.at}</td>
              <td>{row.kind}</td>
              <td className="mono">{row.commandId ?? ''}</td>
              <td>{row.outcome ?? ''}</td>
              <td className="muted">{row.detail ?? ''}</td>
              <td className="muted">{row.operatorId ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly before?: string }>;
}) {
  const { operator, allowed } = await requireOperator('audit.read');
  const nav = <OperatorNav name={operator.displayName} current="audit" />;
  if (!allowed)
    return (
      <>
        {nav}
        <NotPermitted />
      </>
    );
  const { database, commands } = adminRuntime();
  const { db } = database;
  if (commands) await reconcileOpenCommands(commands, operator.id);
  const unknown = await openCommands(db, RECONCILE_BATCH);
  const before = Number((await searchParams).before);
  const rows = await readAuditPage(db, {
    limit: pageSize,
    ...(Number.isSafeInteger(before) && before > 0 ? { before } : {}),
  });
  const badge = chainBadge(
    await verifyStoredChain(db),
    await acknowledgedAnchors(db),
  );
  const oldest = rows.at(-1)?.seq;
  return (
    <>
      {nav}
      <div className="page-head">
        <div>
          <p className="eyebrow">Operator actions</p>
          <h1>Audit</h1>
        </div>
        <p
          className={badge.ok ? 'badge-ok' : 'badge-bad'}
          data-testid="chain-badge"
        >
          {badge.text}
        </p>
      </div>
      <section className="section">
        <h2>Unknown outcomes</h2>
        <UnknownCommands commands={unknown} />
      </section>
      <section className="section">
        <h2>Events</h2>
        <EventsTable rows={rows} />
        {rows.length === pageSize && oldest !== undefined && oldest > 1 ? (
          <p>
            <a href={`/audit?before=${oldest}`}>Older events</a>
          </p>
        ) : null}
      </section>
    </>
  );
}
