import { renderShareImage } from '../lib/share-image';

export const alt = 'Daisy Debate — Competitive debate, structured like chess.';
export const size = { width: 1600, height: 900 };
export const contentType = 'image/png';

export default function TwitterImage() {
  return renderShareImage('x');
}
