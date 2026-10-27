import type { Metadata } from 'next';
import { termsDocument } from '../../../features/legal/documents';
import { LegalPage } from '../../../ui/legal/legal-page/legal-page';

export const metadata: Metadata = { title: 'Terms of service' };

/** Public: the rules for using Daisy Debate. */
export default function TermsPage() {
  return <LegalPage document={termsDocument} />;
}
