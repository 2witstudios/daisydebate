import { redirect } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../features/access/page-access';
/** Waiting uses the same fresh assignment list; query parameters cannot invent a match. */
export default async function JudgeWaitingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/judge/waiting', searchParams);
  redirect('/judge');
}
