import type { Metadata } from 'next';
import { Dashboard } from '../../ui/dashboard/dashboard';
import { requestLinkAction } from '../(bare)/sign-in/actions';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/** The hero's join is the sign-in page's action, landing on this page. */
export default function HomePage() {
  return <Dashboard requestLink={requestLinkAction.bind(null, '/')} />;
}
