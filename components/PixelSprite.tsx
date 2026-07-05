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

// ---------- 5x7 pixel glyphs for card ranks & values ----------
// hand-drawn so 5/S and 8/B stay unmistakable

const GLYPHS: Record<string, string[]> = {
  '0': ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
  '1': ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
  '2': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
  '3': ['XXXX.', '....X', '...X.', '..XX.', '....X', 'X...X', '.XXX.'],
  '4': ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  '6': ['..XX.', '.X...', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '..X..', '..X..', '..X..'],
  '8': ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  '9': ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '...X.', '.XX..'],
  'A': ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  'J': ['..XXX', '...X.', '...X.', '...X.', '...X.', 'X..X.', '.XX..'],
  'Q': ['.XXX.', 'X...X', 'X...X', 'X...X', 'X.X.X', 'X..X.', '.XX.X'],
  'K': ['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'],
  '-': ['.....', '.....', '.....', 'XXXX.', '.....', '.....', '.....'],
};

export const PixelText = memo(function PixelText({
  text, height, color, className, style,
}: {
  text: string;
  height: number; // rendered height in px
  color: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const chars = [...text];
  const w = chars.length * 6 - 1;
  const rects: React.ReactNode[] = [];
  chars.forEach((ch, ci) => {
    const g = GLYPHS[ch];
    if (!g) return;
    const ox = ci * 6;
    g.forEach((row, y) => {
      let x = 0;
      while (x < 5) {
        if (row[x] !== 'X') { x++; continue; }
        let x2 = x + 1;
        while (x2 < 5 && row[x2] === 'X') x2++;
        rects.push(<rect key={`${ci}-${y}-${x}`} x={ox + x} y={y} width={x2 - x} height={1} fill={color} />);
        x = x2;
      }
    });
  });
  return (
    <svg viewBox={`0 0 ${w} 7`} height={height} width={(height / 7) * w}
      shapeRendering="crispEdges" className={className} style={style} aria-label={text}>
      {rects}
    </svg>
  );
});
