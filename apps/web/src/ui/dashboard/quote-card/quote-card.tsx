import Image from 'next/image';
import { art } from '../../assets';
import styles from './quote-card.module.css';

export function QuoteCard() {
  return (
    <figure className={styles.quoteCard}>
      <Image
        src={art.quoteRidge.src}
        alt=""
        fill
        sizes="316px"
        className={styles.photo}
      />
      <span className={styles.scrim} aria-hidden="true" />
      <span className={styles.mark} aria-hidden="true">
        &ldquo;
      </span>
      <blockquote className={styles.quote}>
        Ideas move people.
        <br />
        Debate changes them.
      </blockquote>
    </figure>
  );
}
