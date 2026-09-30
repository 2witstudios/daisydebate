import type { HostScreen } from '../../features/ranked/drive-host';
import { HostPosted } from './host-posted/host-posted';
import { HostTable } from './host-table/host-table';

/** The host route: the form, or the confirmation after the mock post. */
export function Host({ screen }: { readonly screen: HostScreen }) {
  return screen.step === 'posted' ? (
    <HostPosted screen={screen} />
  ) : (
    <HostTable screen={screen} />
  );
}
