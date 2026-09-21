'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '../../components/icon/icon';
import { useUiState } from '../../store/store';
import { art } from '../../assets';
import styles from './featured-tournament.module.css';

export function FeaturedTournament() {
  const tournament = useUiState((state) => state.resources.tournament);
  return (
    <section className={styles.featured}>
      <div className={styles.content}>
        <header className={styles.header}>
          <Icon name="trophy" size={18} />
          <h2 className={styles.heading}>Featured Tournament</h2>
        </header>
        <p className={styles.name}>{tournament.name}</p>
        <p className={styles.tagline}>{tournament.tagline}</p>
        <Link href="/tournaments" className={styles.register}>
          Register
        </Link>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className="visually-hidden">Dates</dt>
            <dd className={styles.factItem}>
              <Icon name="calendar" size={16} />
              {tournament.dates}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className="visually-hidden">Prize</dt>
            <dd className={styles.factItem}>
              <Icon name="trophy" size={16} />
              {tournament.prizePool}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className="visually-hidden">Entry</dt>
            <dd className={styles.factItem}>
              <Icon name="users" size={16} />
              {tournament.openToAll ? 'Open to All' : 'Invitational'}
            </dd>
          </div>
        </dl>
      </div>
      <div className={styles.artSide} aria-hidden="true">
        <Image
          src={art.earthNight.src}
          alt=""
          fill
          sizes="(max-width: 900px) 100vw, 460px"
          className={styles.artPhoto}
        />
      </div>
    </section>
  );
}
