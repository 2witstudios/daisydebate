import type { Metadata } from 'next';
import { readHostHome, readHostRail } from '../../../features/tab/organization';
import { hostRoutes } from '../../../features/tab/routes';
import { HostHome } from '../../../ui/tab/host-home/host-home';
import { requireGrant } from './require-grant';

export const metadata: Metadata = { title: 'Host' };

export default async function Page() {
  const scene = await requireGrant(hostRoutes.home);
  return <HostHome rail={readHostRail(scene)} home={readHostHome(scene)} />;
}
