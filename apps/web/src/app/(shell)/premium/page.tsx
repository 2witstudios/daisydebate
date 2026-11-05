import type { Metadata } from 'next';
import { PremiumPage } from '../../../ui/premium/premium-page';

export const metadata: Metadata = { title: 'Daisy Premium' };

/** Public product terms; purchase admission is a separate authenticated operation. */
export default function Premium() {
  return <PremiumPage />;
}
