import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import { parseConsoleQuery } from '../../../../../features/tournaments/console';
import { consoleView } from '../../../../../features/tournaments/console-view';
import { getConsole } from '../../../../../features/tournaments/get-console';
import { requireAccess } from '../../../../../lib/access';
import {
  ConsolePage,
  ConsoleUnavailable,
} from '../../../../../ui/tournaments/organize/console/console-page';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Tournament console' };

export default async function ConsoleRoute({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAccess(`/tournaments/organize/${id}`, searchParams);
  const data = getConsole(id);
  if (!data) return <ConsoleUnavailable />;
  return (
    <ConsolePage
      view={consoleView(data, parseConsoleQuery(await searchParams))}
    />
  );
}
