'use client';

import { useRouter } from 'next/navigation';
import { controlClass } from '../../components/form-field/form-field-class';

/**
 * Settings' sections on a phone (board "Settings media release, phone"): one
 * select instead of the side list, which jumps to a section or opens Billing.
 */
export function SectionJump({
  sections,
}: {
  readonly sections: readonly (readonly [href: string, label: string])[];
}) {
  const router = useRouter();
  return (
    <div className="hidden flex-col gap-1 max-compact:flex">
      <label htmlFor="settings-jump" className="text-sm font-strong text-ink">
        Section
      </label>
      <select
        id="settings-jump"
        className={controlClass}
        defaultValue=""
        onChange={(event) => {
          const href = event.target.value;
          if (href.startsWith('#'))
            document.getElementById(href.slice(1))?.scrollIntoView();
          else if (href !== '') router.push(href);
        }}
      >
        <option value="" disabled>
          Jump to a section
        </option>
        {sections.map(([href, label]) => (
          <option key={href} value={href}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
