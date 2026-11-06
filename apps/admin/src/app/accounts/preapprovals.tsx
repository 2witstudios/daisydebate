import Link from 'next/link';
import type { PreapprovalPage } from '@daisy/protocol/beta-preapproval';
import { preapprovalAction } from './actions';

export function Preapprovals({
  page,
}: {
  readonly page: PreapprovalPage | null;
}) {
  return (
    <section aria-labelledby="preapprovals-heading">
      <h2 id="preapprovals-heading">Preapproved emails</h2>
      <p>
        Preapprovals remain valid until removed. Removing a claimed entry does
        not revoke the account.
      </p>
      <form action={preapprovalAction}>
        <input type="hidden" name="operation" value="add" />
        <label htmlFor="preapproval-email">Email</label>
        <input
          id="preapproval-email"
          name="email"
          type="email"
          maxLength={320}
          required
          autoComplete="off"
        />
        <button
          type="submit"
          name="delivery"
          value="invite"
          className="button-primary"
        >
          Invite by email
        </button>
        <button type="submit" name="delivery" value="silent">
          Preapprove only
        </button>
      </form>
      {page === null ? (
        <p role="alert">Preapproved emails could not be loaded. Try again.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Created (UTC)</th>
                  <th>Status</th>
                  <th>Invitation delivery</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{entry.email}</th>
                    <td>{entry.createdAt}</td>
                    <td>{entry.status}</td>
                    <td>{entry.invitation}</td>
                    <td>
                      <form action={preapprovalAction}>
                        <input
                          type="hidden"
                          name="preapprovalId"
                          value={entry.id}
                        />
                        <input
                          type="hidden"
                          name="expectedRevision"
                          value={entry.revision}
                        />
                        <button type="submit" name="operation" value="invite">
                          {entry.invitation === 'none'
                            ? 'Send invitation'
                            : 'Resend invitation'}
                        </button>
                        <button type="submit" name="operation" value="remove">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.items.length === 0 ? <p>No preapproved emails.</p> : null}
          {page.nextCursor ? (
            <p>
              <Link href={`/accounts?preapprovalCursor=${page.nextCursor}`}>
                Next preapprovals page
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
