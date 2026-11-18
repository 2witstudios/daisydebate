import { requireTabRelease } from '../../features/tab/release';
import { VisitorFeatures } from '../visitor-features';

/**
 * A live Round renders outside the product shell, so a live event Room on
 * sample data does too: one main landmark, behind the Tab release.
 */
export default async function TabLiveLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireTabRelease();
  return (
    <>
      <main>{children}</main>
      <VisitorFeatures />
    </>
  );
}
