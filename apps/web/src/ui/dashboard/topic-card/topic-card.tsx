'use client';

import { Panel } from '../../components/panel/panel';
import { Button } from '../../components/button/button';
import { useUiState } from '../../store/store';

export function TopicCard() {
  const todaysTopic = useUiState((state) => state.resources.todaysTopic);
  return (
    <Panel title="Today's Topic">
      <p className="mb-5 font-display text-xl leading-tight font-semibold text-balance">
        {todaysTopic}
      </p>
      <Button variant="secondary" className="w-full">
        Join the Discussion
      </Button>
    </Panel>
  );
}
