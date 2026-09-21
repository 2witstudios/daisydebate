'use client';

import { Panel } from '../../components/panel/panel';
import { Button } from '../../components/button/button';
import { useUiState } from '../../store/store';

export function TopicCard() {
  const todaysTopic = useUiState((state) => state.resources.todaysTopic);
  return (
    <Panel icon="message" title="Today's Topic">
      <p className="mb-4 text-base leading-topic-question font-semibold">
        {todaysTopic}
      </p>
      <Button variant="secondary" className="w-full">
        Join the Discussion
      </Button>
    </Panel>
  );
}
