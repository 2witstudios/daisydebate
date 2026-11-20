import type { Metadata } from 'next';
import { youthContentWaiverDocument } from '../../../features/legal/agreements';
import { LegalPage } from '../../../ui/legal/legal-page/legal-page';

export const metadata: Metadata = { title: 'Youth ranked content waiver' };

/** Public: what a member in the Youth lobby signs before ranked play (ADR 0161). */
export default function YouthContentWaiverPage() {
  return <LegalPage document={youthContentWaiverDocument} />;
}
