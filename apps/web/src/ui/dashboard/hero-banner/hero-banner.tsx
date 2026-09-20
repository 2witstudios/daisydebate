import Image from 'next/image';
import { art } from '../../assets';
import styles from './hero-banner.module.css';

export function HeroBanner() {
  return (
    <section className={styles.hero}>
      <Image
        src={art.heroRidge.src}
        alt={art.heroRidge.alt}
        fill
        priority
        sizes="(max-width: 1100px) 100vw, 1180px"
        className={styles.photo}
      />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.content}>
        <h1 className={styles.headline}>Join the marketplace of ideas</h1>
        <p className={styles.sub}>
          Where ideas compete. The best arguments win.
        </p>
      </div>
      <p className={styles.quote}>
        &ldquo;Trade arguments.
        <br />
        Earn credibility.&rdquo;
      </p>
    </section>
  );
}
