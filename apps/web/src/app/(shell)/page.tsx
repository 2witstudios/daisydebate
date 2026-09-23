import type { Metadata } from 'next';
import { Dashboard } from '../../ui/dashboard/dashboard';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return <Dashboard />;
}
