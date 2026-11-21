import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { LegalDocument } from '../../../../features/legal/documents';
import { guardianNoticeDocument } from '../../../../features/legal/guardian-notices';
import {
  requestFamilyRows,
  requestFriendApprovals,
} from '../../../../lib/request-session';
import { ProtectionLevelForm } from '../../../../ui/settings/parental-controls/protection-level-form';
import { protectionLevelLabels } from '../../../../features/parental-controls/protection-level-labels';
import { GuardianForm } from '../../../../ui/settings/parental-controls/guardian-form';
import { StatusRegion } from '../../../../ui/components/status-region/status-region';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { controlClass } from '../../../../ui/components/form-field/form-field-class';
import { parentalControlsAction } from './actions';

function Notice({ document }: { readonly document: LegalDocument }) {
  return (
    <>
      <details className="text-sm text-ink">
        <summary className="cursor-pointer font-semibold">
          {document.title} ({document.version})
        </summary>
        <div className="flex flex-col gap-3 py-3">
          <p>{document.lede}</p>
          {document.sections.map((section) => (
            <div key={section.id} className="flex flex-col gap-1">
              <h3 className="font-semibold">{section.heading}</h3>
              {section.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </div>
          ))}
        </div>
      </details>
      <input name="noticeVersion" type="hidden" value={document.version} />
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          name="agree"
          type="checkbox"
          value="yes"
          required
          className="mt-1 accent-accent"
        />
        I have read and agree to this notice.
      </label>
    </>
  );
}

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-1';
const title = 'font-display text-xl font-bold text-ink';
const version = 1 as const;

export async function FamilySettings({
  role,
  childAccountClosed = false,
}: {
  readonly role: 'adult' | 'child';
  readonly childAccountClosed?: boolean;
}) {
  const adult = role === 'adult';
  const [rows, approvals] = await Promise.all([
    requestFamilyRows(role),
    adult ? requestFriendApprovals() : [],
  ]);
  if (!rows) notFound();
  const notice = guardianNoticeDocument(
    adult ? 'parental-consent' : 'child-confirmation',
  );
  const action = (command: Parameters<typeof parentalControlsAction>[0]) =>
    parentalControlsAction.bind(null, command);
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 py-5 max-compact:px-4">
      <Link href="/settings" className="self-start text-sm text-ink-muted">
        Settings
      </Link>
      <PageHeader title={adult ? 'Parental controls' : 'Your parents'} />
      {childAccountClosed ? (
        <StatusRegion as="p" role="status">
          Your child’s account was closed.
        </StatusRegion>
      ) : null}
      {adult ? (
        <section
          id="waiting-for-you"
          className={card}
          aria-labelledby="waiting-title"
        >
          <h2 id="waiting-title" className={title}>
            Waiting for you
          </h2>
          {approvals.length ? (
            <ul className="flex flex-col gap-3">
              {approvals.map((item) => (
                <li key={item.id} className="flex flex-col gap-2">
                  <p>
                    {item.direction === 'incoming'
                      ? `@${item.counterpart} sent @${item.child} a friend request.`
                      : `@${item.child} asked to be friends with @${item.counterpart}.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <GuardianForm
                      action={action({
                        type: 'answer-friend-approval',
                        version,
                        approvalId: item.id,
                        decision: 'approve',
                      })}
                      label="Approve friend request"
                    />
                    <GuardianForm
                      action={action({
                        type: 'answer-friend-approval',
                        version,
                        approvalId: item.id,
                        decision: 'decline',
                      })}
                      label="Decline friend request"
                      secondary
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">
              No friend requests need approval.
            </p>
          )}
        </section>
      ) : null}
      <section className={card} aria-labelledby="family-title">
        <h2 id="family-title" className={title}>
          {adult ? 'Your children' : 'Linked parents and requests'}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {adult
              ? 'No children added yet.'
              : 'You have no parent links or requests.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
              >
                <div>
                  <h3 className="font-semibold text-ink">{row.label}</h3>
                  <p className="text-sm text-ink-muted">
                    {row.status === 'active'
                      ? 'Linked'
                      : row.status === 'not-confirmed'
                        ? 'Not confirmed'
                        : adult
                          ? 'Waiting for your child'
                          : 'Asked to link as your parent'}
                  </p>
                </div>
                {row.protectionLevel ? (
                  adult ? (
                    <ProtectionLevelForm
                      action={action({
                        type: 'set-protection-level',
                        linkId: row.id,
                      })}
                      choice={row.protectionLevel}
                      child={row.label}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">
                      Protection level:{' '}
                      {protectionLevelLabels[row.protectionLevel.level]}
                    </p>
                  )
                ) : null}
                {adult && row.request ? (
                  <div className="flex flex-wrap gap-2">
                    <GuardianForm
                      action={action({
                        type: 'send-again',
                        version,
                        request: row.request,
                      })}
                      label="Send again"
                      secondary
                    />
                    <GuardianForm
                      action={action({
                        type: 'cancel-request',
                        version,
                        request: row.request,
                      })}
                      label="Cancel"
                      secondary
                    />
                  </div>
                ) : null}
                {adult && row.status === 'active' ? (
                  <Link
                    href={`/settings/parental-controls/${row.id}`}
                    aria-label={`More for ${row.label}`}
                    className="self-start text-sm font-semibold"
                  >
                    More
                  </Link>
                ) : null}
                {adult && row.status === 'active' ? (
                  <GuardianForm
                    action={action({
                      type: 'end-link',
                      version,
                      linkId: row.id,
                    })}
                    label="End link"
                    secondary
                  />
                ) : null}
                {!adult && row.status === 'waiting' ? (
                  <div className="flex flex-col gap-3">
                    <GuardianForm
                      action={action({
                        type: 'confirm-parent',
                        version,
                        linkId: row.id,
                        noticeVersion: notice.version,
                      })}
                      label="Yes, this is my parent"
                    >
                      <Notice document={notice} />
                    </GuardianForm>
                    <GuardianForm
                      action={action({
                        type: 'refuse-parent',
                        version,
                        linkId: row.id,
                      })}
                      label="No, this isn’t my parent"
                      secondary
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {!adult && rows.some((row) => row.status === 'active') ? (
          <div className="flex flex-col gap-1 text-sm text-ink">
            <h3 className="font-semibold">What your linked parents can see</h3>
            {notice.sections
              .find((section) => section.id === 'what-they-can-do')
              ?.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
          </div>
        ) : null}
        {adult ? null : (
          <Link href="/help" className="self-start text-sm">
            Get help with safety
          </Link>
        )}
      </section>
      {adult ? (
        <section className={card} aria-labelledby="add-child">
          <h2 id="add-child" className={title}>
            Add a child
          </h2>
          <details className="flex flex-col gap-2">
            <summary className="cursor-pointer font-semibold text-ink">
              Create a child’s account
            </summary>
            <div className="pt-3">
              <GuardianForm
                action={action({ type: 'create-child-account' })}
                label="Email my child"
              >
                <label className="flex w-full flex-col gap-1 text-sm">
                  First name
                  <input
                    name="firstName"
                    className={controlClass}
                    maxLength={40}
                    required
                  />
                </label>
                <label className="flex w-full flex-col gap-1 text-sm">
                  Birth month and year
                  <input
                    name="birthMonth"
                    type="month"
                    className={controlClass}
                    required
                  />
                </label>
                <label className="flex w-full flex-col gap-1 text-sm">
                  Child’s email
                  <input
                    name="email"
                    type="email"
                    className={controlClass}
                    maxLength={320}
                    required
                  />
                </label>
                <Notice document={notice} />
              </GuardianForm>
            </div>
          </details>
          <details className="flex flex-col gap-2">
            <summary className="cursor-pointer font-semibold text-ink">
              Link an existing account
            </summary>
            <div className="pt-3">
              <GuardianForm
                action={action({ type: 'request-link' })}
                label="Ask to link"
              >
                <label className="flex w-full flex-col gap-1 text-sm">
                  Child’s username
                  <input name="username" className={controlClass} required />
                </label>
                <Notice document={notice} />
              </GuardianForm>
            </div>
          </details>
        </section>
      ) : null}
    </main>
  );
}
