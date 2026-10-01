import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { getTournament } from '../../../../../features/tournaments/get-tournament';
import {
  parseRegisterQuery,
  registerFlow,
} from '../../../../../features/tournaments/register-flow';
import { requireAccess } from '../../../../../lib/access';
import { RegisterPage } from '../../../../../ui/tournaments/register/register-page';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Register' };

export default async function RegisterRoute({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAccess(`/tournaments/enter/${id}`, searchParams);
  const view = getTournament(id, true);
  if (!view) notFound();
  return (
    <RegisterPage
      screen={registerFlow(view, parseRegisterQuery(await searchParams))}
    />
  );
}
