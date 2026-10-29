import { renderShareImage } from '../lib/share-image';

export const alt = 'Daisy Debate — Competitive debate, structured like chess.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return renderShareImage('og');
}
