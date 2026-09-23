'use client';

import Link from 'next/link';
import { Panel } from '../../components/panel/panel';
import { buttonClass } from '../../components/button/button-class';
import { useUiState } from '../../store/store';

export function TopicCard() {
  const todaysTopic = useUiState((state) => state.resources.todaysTopic);
  return (
    <Panel title="Today's Topic">
      <p className="mb-5 font-display text-xl leading-tight font-semibold text-balance">
        {todaysTopic}
      </p>
      <Link href="/play" className={`${buttonClass('secondary')} w-full`}>
        Join the Discussion
      </Link>
    </Panel>
  );
}
