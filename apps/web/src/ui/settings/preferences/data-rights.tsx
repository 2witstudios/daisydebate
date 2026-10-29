import type { DataRightsNotices } from '../../../features/account/data-rights/notices';
import { buttonClass } from '../../components/button/button-class';
import { Notice } from '../../components/notice/notice';

const fieldsetLegend = 'text-sm font-strong text-ink';
const helper = 'text-sm text-ink-muted';
const checkboxLine = 'flex items-start gap-3 text-base leading-normal text-ink';

const exportNotice: Readonly<
  Record<Exclude<DataRightsNotices['exportData'], null>, string>
> = {
  'rate-limited': 'Too many export requests. Try again later.',
  refused: 'Your data could not be exported. Try again.',
};

const eraseNotice: Readonly<
  Record<Exclude<DataRightsNotices['erase'], null>, string>
> = {
  confirm: 'Tick the box to confirm you want your account closed.',
  'rate-limited': 'Too many erasure requests. Try again later.',
  refused: 'Your account could not be closed. Try again.',
};

/**
 * The member's data rights (ISSUE-833): a download of everything their
 * export returns, and the one control that closes their account. Both are
 * native form posts to real routes, so they work before hydration and with
 * JavaScript off; the server re-checks every gate. The copy says the
 * consequence, once, and links the page that owns the policy.
 */
export function DataRights({
  notices,
}: {
  readonly notices: DataRightsNotices;
}) {
  return (
    <div className="flex flex-col gap-6 border-t border-border pt-6">
      {notices.exportData ? (
        <Notice
          tone="gold"
          icon="info"
          title={exportNotice[notices.exportData]}
          role="status"
        />
      ) : null}
      {notices.erase ? (
        <Notice
          tone="gold"
          icon="info"
          title={eraseNotice[notices.erase]}
          role="status"
        />
      ) : null}
      <div className="flex flex-col gap-3">
        <h3 className={fieldsetLegend}>Your data</h3>
        {/* A native post: the download answers the form itself. */}
        <form method="post" action="/api/privacy/export">
          <button type="submit" className={buttonClass('secondary') + ' w-fit'}>
            Download your data
          </button>
        </form>
        <p className={helper}>
          A JSON file of what the privacy policy lists as yours. An export
          cannot be recalled once downloaded.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className={fieldsetLegend}>Close your account</h3>
        <p className={helper}>
          Closing your account deletes your private data and signs you out
          everywhere. It cannot be undone. Your username stays on the
          competitive record, shown as closed, and cannot be reused.
        </p>
        {/* A native post with one server-checked confirmation. */}
        <form method="post" action="/api/privacy/erase">
          <label className={checkboxLine}>
            <input type="checkbox" name="confirm" value="on" />
            <span>I understand this cannot be undone.</span>
          </label>
          <div className="pt-3">
            <button type="submit" className={buttonClass('primary') + ' w-fit'}>
              Close your account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
