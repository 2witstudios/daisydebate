import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Train' };

export default async function TrainPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train', searchParams);
  return (
    <RouteShell
      title="Train"
      lede="Practice arguments and sharpen your mind."
      planned={[
        'Guided practice debates against paced prompts',
        'Argument drills with instant structure feedback',
        'Spaced review of your saved arguments',
      ]}
    />
  );
}
