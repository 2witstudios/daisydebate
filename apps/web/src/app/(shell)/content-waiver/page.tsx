import type { Metadata } from 'next';
import { contentWaiverDocument } from '../../../features/legal/agreements';
import { LegalPage } from '../../../ui/legal/legal-page/legal-page';

export const metadata: Metadata = { title: 'Ranked content waiver' };

/** Public: what a member signs before ranked play. */
export default function ContentWaiverPage() {
  return <LegalPage document={contentWaiverDocument} />;
}
