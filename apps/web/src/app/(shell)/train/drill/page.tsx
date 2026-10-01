import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import {
  drillScreen,
  parseDrillQuery,
} from '../../../../features/train/drill-view';
import { requireAccess } from '../../../../lib/access';
import { Drill } from '../../../../ui/train/drill/drill';
import { drillAction } from './actions';

export const metadata: Metadata = { title: 'Argument drill' };

export default async function DrillPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/drill', searchParams);
  const screen = drillScreen(parseDrillQuery(await searchParams));
  return <Drill screen={screen} action={drillAction} />;
}
