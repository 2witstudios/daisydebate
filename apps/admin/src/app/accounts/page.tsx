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
        className={
          state === 'approved' ? 'button-primary button-small' : 'button-small'
        }
        aria-label={`${verb} ${account.username ?? account.userId}`}
      >
        {verb}
        <span className="account-target">
          {account.username ?? account.userId}
        </span>
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
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Signed up (UTC)</th>
            <th>Decided (UTC)</th>
            <th className="numeric">Revision</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {page.items.map((account) => (
            <tr key={account.userId}>
              <th scope="row">{account.username ?? '—'}</th>
              <td className="muted">{account.requestedAt}</td>
              <td className="muted">{account.decidedAt ?? '—'}</td>
              <td className="numeric">{account.accessRevision}</td>
              <td>
                <div className="row-actions">
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
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, unknown>>>;
}) {
  const { operator, allowed } = await requireOperator('accounts.read');
  const nav = <OperatorNav name={operator.displayName} current="accounts" />;
  const heading = (
    <div className="page-head">
      <div>
        <p className="eyebrow">Beta access</p>
        <h1>Accounts</h1>
      </div>
    </div>
  );
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
        {heading}
        <p role="status" className="notice">
          {noticeText('unconfigured', null)}
        </p>
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
      {heading}
      {query.notice ? (
        <p
          role="status"
          data-testid="command-notice"
          className="notice notice-ok"
        >
          {noticeText(query.notice, query.mail)}
        </p>
      ) : null}
      {open > 0 ? (
        <form action={reconcileAction} className="notice notice-warn">
          <p>
            {open} {open === 1 ? 'command has' : 'commands have'} an unknown
            outcome.
          </p>
          <button type="submit">Reconcile</button>
        </form>
      ) : null}
      <nav aria-label="Beta access" className="tabs">
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
