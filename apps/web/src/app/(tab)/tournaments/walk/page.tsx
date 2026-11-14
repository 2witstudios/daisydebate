import type { Metadata } from 'next';
import { requestSampleScene } from '../../../../features/tab/sample/request-scene';
import { readWalk } from '../../../../features/tab/walk';
import { Walk } from '../../../../ui/tab/walk/walk';
import { chooseSampleScene } from './actions';

export const metadata: Metadata = {
  title: 'Walk the sample tournament',
  robots: { index: false },
};

export default async function WalkPage() {
  return (
    <Walk
      walk={readWalk(await requestSampleScene())}
      choose={chooseSampleScene}
    />
  );
}
