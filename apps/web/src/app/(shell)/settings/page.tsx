import Link from 'next/link';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { ThemeSwitcher } from '../../../ui/components/theme-switcher/theme-switcher';
import { prose } from '../../ui/prose-class';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/settings', searchParams);
  return (
    <>
      <h1 className={prose.h1}>Settings</h1>
      <section aria-labelledby="appearance-heading">
        <h2 className={prose.h2} id="appearance-heading">
          Appearance
        </h2>
        <ThemeSwitcher />
      </section>
      <section aria-labelledby="security-heading">
        <h2 className={prose.h2} id="security-heading">
          Security
        </h2>
        <Link href="/settings/security">Account security</Link>
      </section>
    </>
  );
}
