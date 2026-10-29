import { ImageResponse } from 'next/og';
import { RasterMark } from '../ui/brand/raster-mark';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(<RasterMark size={size.width} tile />, size);
}
