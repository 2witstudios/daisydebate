import { mediaReleaseWording } from '@daisy/protocol/media-release';
import type { FormValues } from '../../../features/forms/form-state';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import { Counsel } from './release-terms';

const checkbox = 'mt-0.5 size-5 shrink-0 accent-accent';

type ReleaseFields = { readonly minor: string; readonly values: FormValues };

export function ReleasePaidAdsFields({ minor, values }: ReleaseFields) {
  return (
    <>
      <input
        type="hidden"
        name="wordingVersion"
        value={mediaReleaseWording.version}
      />
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border-strong bg-surface p-5">
        <legend className="px-1 font-bold">
          Paid advertising{' '}
          <span className="font-book text-ink-muted">· optional, separate</span>
        </legend>
        <p className="text-sm text-ink-muted">
          Daisy may want to use a clip of @{minor} in an ad we pay to show.
          Signing the release above does not allow this.
        </p>
        <label className="flex min-h-release-target cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="paidAds"
            defaultChecked={values['paidAds'] === 'on'}
            className={checkbox}
          />
          <span className="min-w-0">
            Also allow clips of @{minor} in Daisy’s paid advertising
            <span className="block text-sm text-ink-muted">
              Off unless you tick it.{' '}
              <Counsel>ad-use terms and any compensation</Counsel>
            </span>
          </span>
        </label>
      </fieldset>
    </>
  );
}

export function ReleaseSignatureFields({ minor, values }: ReleaseFields) {
  return (
    <>
      <div className="flex flex-wrap gap-4">
        <div className={`${fieldClass} flex-2 basis-release-name`}>
          <label htmlFor="release-signer" className={labelClass}>
            Your full name
          </label>
          <input
            id="release-signer"
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            defaultValue={values['name'] ?? ''}
            className={controlClass}
          />
        </div>
        <div className={`${fieldClass} flex-1 basis-release-relation`}>
          <label htmlFor="release-relation" className={labelClass}>
            You are @{minor}’s
          </label>
          <select
            id="release-relation"
            name="relation"
            defaultValue={values['relation'] ?? 'parent'}
            className={controlClass}
          >
            <option value="parent">Parent</option>
            <option value="legal_guardian">Legal guardian</option>
          </select>
        </div>
      </div>
      <label className="flex min-h-release-target cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name="attests"
          required
          defaultChecked={values['attests'] === 'on'}
          className={checkbox}
        />
        <span className="min-w-0">
          I am @{minor}’s parent or legal guardian, I have read the release, and
          I agree to it.
          <span className="block text-sm text-ink-muted">
            <Counsel>signature and attestation wording</Counsel>
          </span>
        </span>
      </label>
    </>
  );
}
