import { renderShareImage } from '../lib/share-image';

export const alt =
  'Daisy Debate — The arena for competitive debate. Better arguments. A more thoughtful world.';
export const size = { width: 1600, height: 900 };
export const contentType = 'image/png';

export default function TwitterImage() {
  return renderShareImage('x');
}
