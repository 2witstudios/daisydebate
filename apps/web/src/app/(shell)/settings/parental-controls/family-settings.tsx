import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { GuardianCommand } from '@daisy/protocol/guardians';
import type { LegalDocument } from '../../../../features/legal/documents';
import { guardianNoticeDocument } from '../../../../features/legal/guardian-notices';
import { requireAccess } from '../../../../lib/access';
import { requestFamilyRows } from '../../../../lib/request-session';
import { GuardianForm } from '../../../../ui/settings/parental-controls/guardian-form';
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
}: {
  readonly role: 'adult' | 'child';
}) {
  const adult = role === 'adult';
  const path = adult ? '/settings/parental-controls' : '/settings/your-parents';
  await requireAccess(path, Promise.resolve({}));
  const rows = await requestFamilyRows(role);
  if (!rows) notFound();
  const notice = guardianNoticeDocument(
    adult ? 'parental-consent' : 'child-confirmation',
  );
  const action = (command: Pick<GuardianCommand, 'type'> | GuardianCommand) =>
    parentalControlsAction.bind(null, command);
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 py-5 max-compact:px-4">
      <Link href="/settings" className="self-start text-sm text-ink-muted">
        Settings
      </Link>
      <PageHeader title={adult ? 'Parental controls' : 'Your parents'} />
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
