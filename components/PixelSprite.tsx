'use client';
import { memo } from 'react';

// Generic pixel-grid → crisp SVG renderer. 'X' = fill, '.' = transparent,
// 'o' = secondary color (lighter shade).

function gridRects(grid: string[], fill: string, fill2?: string) {
  const rects: React.ReactNode[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') { x++; continue; }
      let x2 = x + 1;
      while (x2 < row.length && row[x2] === ch) x2++;
      rects.push(
        <rect key={`${y}-${x}`} x={x} y={y} width={x2 - x} height={1}
          fill={ch === 'o' ? (fill2 ?? fill) : fill} />
      );
      x = x2;
    }
  });
  return rects;
}

export const PixelSprite = memo(function PixelSprite({
  grid, color, color2, size, className, style,
}: {
  grid: string[];
  color: string;
  color2?: string;
  size: number; // rendered width in px
  className?: string;
  style?: React.CSSProperties;
}) {
  const w = grid[0].length;
  const h = grid.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={size} height={(size / w) * h}
      shapeRendering="crispEdges" className={className} style={style} aria-hidden>
      {gridRects(grid, color, color2)}
    </svg>
  );
});

// ---------- suits ----------

const HEART = [
  '.XX..XX.',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXXX..',
  '...XX...',
];
const DIAMOND = [
  '...XX...',
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXXX..',
  '...XX...',
];
const SPADE = [
  '...XX...',
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '...XX...',
  '..XXXX..',
];
const CLUB = [
  '..XXXX..',
  '..XXXX..',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '...XX...',
  '..XXXX..',
];
const STAR = [
  '...XX...',
  '..XXXX..',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXXX..',
  '.XX..XX.',
  'XX....XX',
];

const SUIT_GRIDS: Record<string, string[]> = {
  '♥': HEART, '♦': DIAMOND, '♠': SPADE, '♣': CLUB, '★': STAR,
};

export const PixelSuit = memo(function PixelSuit({
  suit, size, color, className, style,
}: {
  suit: string;
  size: number;
  color: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <PixelSprite grid={SUIT_GRIDS[suit] ?? STAR} color={color} size={size}
      className={className} style={style} />
  );
});

// ---------- decorations ----------

export const CLOUD = [
  '......XXXX......',
  '....XXXXXXXX....',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
];

export const SPARKLE = [
  '...X...',
  '...X...',
  '.XXXXX.',
  'X.XXX.X',
  '.XXXXX.',
  '...X...',
  '...X...',
];

export const CROWN = [
  'X..X..X',
  'X..X..X',
  'XXXXXXX',
  'XXXXXXX',
];

export const EYE = [
  '..XXXX..',
  '.XooooX.',
  'XooXXooX',
  'XooXXooX',
  '.XooooX.',
  '..XXXX..',
];

export const LIGHTNING = [
  '...XXX.',
  '..XXX..',
  '.XXXX..',
  'XXXXXX.',
  '...XXX.',
  '..XXX..',
  '.XXX...',
  '.XX....',
];
