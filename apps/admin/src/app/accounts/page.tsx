import { requireOperator } from '../../server/operator-gate';
import { NotPermitted, OperatorNav } from '../operator-nav';

export const dynamic = 'force-dynamic';

/** BETA-5 fills this page in once the signed operator API lands. */
export default async function AccountsPage() {
  const { operator, allowed } = await requireOperator('accounts.read');
  return (
    <>
      <OperatorNav name={operator.displayName} />
      <h1>Accounts</h1>
      {allowed ? (
        <p>
          This page lists accounts awaiting beta access once the operator API
          lands.
        </p>
      ) : (
        <NotPermitted />
      )}
    </>
  );
}
