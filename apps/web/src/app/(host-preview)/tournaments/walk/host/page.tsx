import type { Metadata } from 'next';
import { requireGrant } from '../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../features/tab/routes';
import {
  readHostHome,
  readHostRail,
} from '../../../../../features/tab/sample/read-organization';
import { HostHome } from '../../../../../ui/tab/host-home/host-home';

export const metadata: Metadata = { title: 'Host' };

export default async function Page() {
  const scene = await requireGrant(hostRoutes.home);
  return <HostHome rail={readHostRail(scene)} home={readHostHome(scene)} />;
}
