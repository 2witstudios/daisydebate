import type { Metadata } from 'next';
import { requireTabRelease } from '../../features/tab/release';
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function HostPreviewLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireTabRelease();
  return children;
}
