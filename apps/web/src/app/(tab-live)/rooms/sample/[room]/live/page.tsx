import { notFound } from 'next/navigation';
import { requireTabRelease } from '../../../../../../features/tab/release';

export default async function Page() {
  await requireTabRelease();
  notFound();
}
