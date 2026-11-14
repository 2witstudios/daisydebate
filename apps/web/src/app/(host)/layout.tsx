import { requireTabRelease } from '../../features/tab/release';
import { VisitorFeatures } from '../visitor-features';

/**
 * The host area: everything under `/host`, with its own shell in place of
 * the product shell. Each page draws that shell around itself, because the
 * timeline rail belongs to the tournament or league the page is in.
 */
export default async function HostLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireTabRelease();
  return (
    <>
      {children}
      <VisitorFeatures />
    </>
  );
}
