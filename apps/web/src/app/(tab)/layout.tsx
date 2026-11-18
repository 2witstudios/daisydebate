import { requireTabRelease } from '../../features/tab/release';
import ShellLayout from '../(shell)/layout';

/**
 * Daisy Tab's participant side: the product shell, behind the Tab release.
 * The gate is here and not in the pages, so that with the release closed
 * these addresses answer with the same bare missing page they always have,
 * outside any shell.
 */
export default async function TabLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireTabRelease();
  return <ShellLayout>{children}</ShellLayout>;
}
