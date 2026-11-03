import type { Metadata } from 'next';
import { contentPolicyDocument } from '../../../features/legal/agreements';
import { LegalPage } from '../../../ui/legal/legal-page/legal-page';

export const metadata: Metadata = { title: 'Ranked content policy' };

/** Public: how anyone may stream and post ranked rounds. */
export default function ContentPolicyPage() {
  return <LegalPage document={contentPolicyDocument} />;
}
