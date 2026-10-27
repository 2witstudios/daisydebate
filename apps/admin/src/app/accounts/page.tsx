import Link from 'next/link';
import type { OperatorAccountsPage } from '@daisy/protocol/operator';
import { reconcileOpenCommands } from '../../features/accounts/commands';
import {
  accessTabs,
  accountsHref,
  accountsQuery,
  noticeText,
  type AccessTab,
} from '../../features/accounts/view';
import { requireOperator } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';
import { NotPermitted, OperatorNav } from '../operator-nav';
import { reconcileAction, setBetaAccessAction } from './actions';

export const dynamic = 'force-dynamic';
const pageSize = 25;
const tabLabel: Readonly<Record<AccessTab, string>> = {
  pending: 'Pending',
  approved: 'Approved',
  revoked: 'Revoked',
};

type Account = OperatorAccountsPage['items'][number];

function CommandForm({
  account,
  access,
  state,
}: {
  readonly account: Account;
  readonly access: AccessTab;
  readonly state: 'approved' | 'revoked';
}) {
  const verb = state === 'approved' ? 'Approve' : 'Revoke';
  return (
    <form action={setBetaAccessAction}>
      <input type="hidden" name="userId" value={account.userId} />
      <input type="hidden" name="state" value={state} />
      <input
        type="hidden"
        name="expectedRevision"
        value={account.accessRevision}
      />
      <input type="hidden" name="access" value={access} />
      <button
        type="submit"
        aria-label={`${verb} ${account.username ?? account.userId}`}
      >
        {verb}
      </button>
    </form>
  );
}

function AccountsTable({
  page,
  access,
}: {
  readonly page: OperatorAccountsPage;
  readonly access: AccessTab;
}) {
  if (page.items.length === 0) return <p>No {access} accounts.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Username</th>
          <th>Signed up (UTC)</th>
          <th>Decided (UTC)</th>
          <th>Revision</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {page.items.map((account) => (
          <tr key={account.userId}>
            <td>{account.username ?? '—'}</td>
            <td>{account.requestedAt}</td>
            <td>{account.decidedAt ?? '—'}</td>
            <td>{account.accessRevision}</td>
            <td>
              {account.accessState === 'approved' ? null : (
                <CommandForm
                  account={account}
                  access={access}
                  state="approved"
                />
              )}
              {account.accessState === 'revoked' ? null : (
                <CommandForm
                  account={account}
                  access={access}
                  state="revoked"
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, unknown>>>;
}) {
  const { operator, allowed } = await requireOperator('accounts.read');
  const nav = <OperatorNav name={operator.displayName} />;
  if (!allowed)
    return (
      <>
        {nav}
        <NotPermitted />
      </>
    );
  const query = accountsQuery(await searchParams);
  const { commands } = adminRuntime();
  if (!commands)
    return (
      <>
        {nav}
        <h1>Accounts</h1>
        <p role="status">{noticeText('unconfigured', null)}</p>
      </>
    );
  const { open } = await reconcileOpenCommands(commands, operator.id);
  const page = await commands.client.listAccounts(operator.id, {
    access: query.access,
    limit: pageSize,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  });
  return (
    <>
      {nav}
      <h1>Accounts</h1>
      {query.notice ? (
        <p role="status" data-testid="command-notice">
          {noticeText(query.notice, query.mail)}
        </p>
      ) : null}
      <nav aria-label="Beta access">
        {accessTabs.map((tab) => (
          <Link
            key={tab}
            href={accountsHref({ access: tab })}
            aria-current={tab === query.access ? 'page' : undefined}
          >
            {tabLabel[tab]}
          </Link>
        ))}
      </nav>
      {open > 0 ? (
        <form action={reconcileAction}>
          <p>
            {open} {open === 1 ? 'command has' : 'commands have'} an unknown
            outcome.
          </p>
          <button type="submit">Reconcile</button>
        </form>
      ) : null}
      {page.kind === 'ok' ? (
        <>
          <AccountsTable page={page.value} access={query.access} />
          {page.value.nextCursor ? (
            <p>
              <Link
                href={accountsHref({
                  access: query.access,
                  cursor: page.value.nextCursor,
                })}
              >
                Next page
              </Link>
            </p>
          ) : null}
        </>
      ) : (
        <p role="alert">
          The participant app could not list accounts
          {page.kind === 'rejected' ? ` (${page.code})` : ''}. Try again.
        </p>
      )}
    </>
  );
}
