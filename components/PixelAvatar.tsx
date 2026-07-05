'use client';
import { memo } from 'react';

// 12x12 pixel critters. Legend: . transparent, B body, D accent, W white,
// K dark, P blush, O orange.

type Palette = { B: string; D: string; W?: string; K?: string; P?: string; O?: string };

const DEFAULTS = { W: '#FFFDFA', K: '#453950', P: '#FF9FB7', O: '#FFAC5F' };

const CHARACTERS: Record<string, { name: string; palette: Palette; grid: string[] }> = {
  cat: {
    name: 'Mochi',
    palette: { B: '#FFC9A3', D: '#E8926F' },
    grid: [
      '..B......B..',
      '.BB......BB.',
      '.BBB....BBB.',
      '.BBBBBBBBBB.',
      'BBBBBBBBBBBB',
      'BBBKWBBKWBBB',
      'BBBKKBBKKBBB',
      'BPPBBDDBBPPB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  bunny: {
    name: 'Clover',
    palette: { B: '#FFC4D6', D: '#F08CAD' },
    grid: [
      '..BB....BB..',
      '..BD....DB..',
      '..BD....DB..',
      '.BBBBBBBBBB.',
      'BBBBBBBBBBBB',
      'BBBKWBBKWBBB',
      'BBBKKBBKKBBB',
      'BPPBBDDBBPPB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  bear: {
    name: 'Pudding',
    palette: { B: '#E0B98C', D: '#B98A5E' },
    grid: [
      '.BB......BB.',
      'BBBB....BBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BBBKWBBKWBBB',
      'BBBKKBBKKBBB',
      'BPPBWWWWBPPB',
      'BBBBWDDWBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  frog: {
    name: 'Lily',
    palette: { B: '#A8E6C1', D: '#6FC49A' },
    grid: [
      '..WW....WW..',
      '..WK....KW..',
      '.BBBBBBBBBB.',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BPPBBBBBBPPB',
      'BBBDDDDDDBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  chick: {
    name: 'Pip',
    palette: { B: '#FFE18A', D: '#F5C94F' },
    grid: [
      '.....BB.....',
      '....BBBB....',
      '.BBBBBBBBBB.',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BBBKWBBKWBBB',
      'BBBKKBBKKBBB',
      'BPPBBOOBBPPB',
      'BBBBBOOBBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  panda: {
    name: 'Bao',
    palette: { B: '#FDFDFD', D: '#4A4A58' },
    grid: [
      '.DD......DD.',
      'DDDD....DDDD',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BBKKKBBKKKBB',
      'BBKWKBBKWKBB',
      'BBKKKBBKKKBB',
      'BPPBBDDBBPPB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  ghost: {
    name: 'Boo',
    palette: { B: '#E3D9FF', D: '#B9A6EE' },
    grid: [
      '...BBBBBB...',
      '.BBBBBBBBBB.',
      '.BBBBBBBBBB.',
      'BBBBBBBBBBBB',
      'BBBKWBBKWBBB',
      'BBBKKBBKKBBB',
      'BPPBBBBBBPPB',
      'BBBBBDDBBBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'B.BB.BB.BB.B',
    ],
  },
  fox: {
    name: 'Rusty',
    palette: { B: '#FFB27D', D: '#E07B4F' },
    grid: [
      '.D........D.',
      '.BB......BB.',
      '.BBB....BBB.',
      '.BBBBBBBBBB.',
      'BBBBBBBBBBBB',
      'BBBKWBBKWBBB',
      'BBBKKBBKKBBB',
      'BPPBWWWWBPPB',
      'BBBBWDDWBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  pig: {
    name: 'Truffle',
    palette: { B: '#FFC0CE', D: '#F49AB5' },
    grid: [
      '.BB......BB.',
      'BBBB....BBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      'BBBKWBBKWBBB',
      'BBBKKBBKKBBB',
      'BPPDDDDDDPPB',
      'BBBDKDDKDBBB',
      'BBBBBBBBBBBB',
      'BBBBBBBBBBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
  penguin: {
    name: 'Pebble',
    palette: { B: '#8FA8C8', D: '#6D87AC' },
    grid: [
      '..BBBBBBBB..',
      '.BBBBBBBBBB.',
      'BBBBBBBBBBBB',
      'BBWWWWWWWWBB',
      'BBWWKWWKWWBB',
      'BBWWWOOWWWBB',
      'BBWWWWWWWWBB',
      'BPPWWWWWWPPB',
      'BBWWWWWWWWBB',
      'BBBWWWWWWBBB',
      '.BBBBBBBBBB.',
      '..BBBBBBBB..',
    ],
  },
};

export const AVATAR_IDS = Object.keys(CHARACTERS);
export function avatarName(id: string) {
  return CHARACTERS[id]?.name ?? 'Mochi';
}

const OUTLINE = '#453950';

export const PixelAvatar = memo(function PixelAvatar({
  id,
  size = 48,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const char = CHARACTERS[id] ?? CHARACTERS.cat;
  const pal: Record<string, string> = { ...DEFAULTS, ...char.palette };
  const rects: React.ReactNode[] = [];
  const filled = new Set<string>();
  char.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') filled.add(`${x},${y}`);
  });
  // 1px pixel outline around the character so it never blends into a background
  const outline: React.ReactNode[] = [];
  for (let y = -1; y <= 12; y++) {
    for (let x = -1; x <= 12; x++) {
      if (filled.has(`${x},${y}`)) continue;
      if (filled.has(`${x + 1},${y}`) || filled.has(`${x - 1},${y}`) ||
          filled.has(`${x},${y + 1}`) || filled.has(`${x},${y - 1}`)) {
        outline.push(<rect key={`o${x},${y}`} x={x} y={y} width={1} height={1} fill={OUTLINE} />);
      }
    }
  }
  char.grid.forEach((row, y) => {
    // merge horizontal runs of the same color into single rects
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') { x++; continue; }
      let x2 = x + 1;
      while (x2 < row.length && row[x2] === ch) x2++;
      rects.push(<rect key={`${y}-${x}`} x={x} y={y} width={x2 - x} height={1} fill={pal[ch] ?? pal.B} />);
      x = x2;
    }
  });
  return (
    <svg
      viewBox="-1 -1 14 14"
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      aria-label={char.name}
    >
      {outline}
      {rects}
    </svg>
  );
});
