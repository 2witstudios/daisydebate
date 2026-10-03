import type { Metadata } from 'next';
import { privacyDocument } from '../../../features/legal/documents';
import { LegalPage } from '../../../ui/legal/legal-page/legal-page';

export const metadata: Metadata = { title: 'Privacy policy' };

/** Public: what Daisy Debate keeps about you, and your choices. */
export default function PrivacyPage() {
  return <LegalPage document={privacyDocument} />;
}
