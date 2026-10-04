import type { Metadata } from 'next';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Debates' };

export default function DebatesPage() {
  return <RouteShell title="Debates" />;
}
