import type { Metadata } from 'next';
import Link from 'next/link';
import { privacyDocument } from '../../../features/legal/documents';
import { LegalPage } from '../../../ui/legal/legal-page/legal-page';

export const metadata: Metadata = { title: 'Privacy policy' };

/** Public: what Daisy Debate keeps about you, and your choices. */
export default function PrivacyPage() {
  return (
    <LegalPage
      document={privacyDocument}
      extra={
        <p className="text-base text-ink-muted">
          You can change your optional analytics choice at any time at{' '}
          <Link href="/analytics">analytics preferences</Link>.
        </p>
      }
    />
  );
}
