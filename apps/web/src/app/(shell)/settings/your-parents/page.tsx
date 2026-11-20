import { FamilySettings } from '../parental-controls/family-settings';

export const metadata = { title: 'Your parents' };

export default function YourParentsPage() {
  return <FamilySettings role="child" />;
}
