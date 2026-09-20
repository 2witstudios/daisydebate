'use client';

import { Panel } from '../../components/panel/panel';
import { Button } from '../../components/button/button';
import { useUiState } from '../../store/store';
import styles from './topic-card.module.css';

export function TopicCard() {
  const todaysTopic = useUiState((state) => state.resources.todaysTopic);
  return (
    <Panel icon="message" title="Today's Topic">
      <p className={styles.question}>{todaysTopic}</p>
      <Button variant="secondary" className={styles.cta}>
        Join the Discussion
      </Button>
    </Panel>
  );
}
