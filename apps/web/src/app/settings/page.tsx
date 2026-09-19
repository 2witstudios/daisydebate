import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <RouteShell
      title="Settings"
      lede="Account, appearance, and notification preferences."
      planned={[
        'Profile and account management',
        'Notification and privacy controls',
        'Session and device management',
      ]}
    />
  );
}
