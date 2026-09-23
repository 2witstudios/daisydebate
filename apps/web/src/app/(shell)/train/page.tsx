import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Train' };

export default function TrainPage() {
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
