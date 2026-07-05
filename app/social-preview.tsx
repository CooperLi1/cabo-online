import type { CSSProperties } from 'react';

const ink = '#453950';
const inkSoft = '#7c6d88';
const bg = '#fdf3ec';
const white = '#fffdfa';
const pinkStrong = '#ff8fab';
const pinkDeep = '#f76e93';
const mint = '#b9ead2';
const lavStrong = '#b9a6ee';
const butterDeep = '#f5c94f';
const sky = '#cde9ff';

type PreviewKind = 'og' | 'twitter';

type SocialPreviewProps = {
  kind: PreviewKind;
  width: number;
  height: number;
};

function rect(key: string, style: CSSProperties) {
  return <div key={key} style={{ position: 'absolute', ...style }} />;
}

function Checker({ width, height }: { width: number; height: number }) {
  const dots = [];
  for (let y = 0; y < height; y += 24) {
    for (let x = (y / 24) % 2 === 0 ? 0 : 12; x < width; x += 24) {
      dots.push(rect(`d-${x}-${y}`, {
        left: x,
        top: y,
        width: 12,
        height: 12,
        background: 'rgba(255,255,255,0.22)',
      }));
    }
  }
  return <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>{dots}</div>;
}

function PixelSparkle({ left, top, size, color = butterDeep }: { left: number; top: number; size: number; color?: string }) {
  const unit = size / 5;
  return (
    <div style={{ position: 'absolute', left, top, width: size, height: size, display: 'flex' }}>
      {[
        [2, 0], [2, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [2, 3], [2, 4],
      ].map(([x, y]) => rect(`s-${x}-${y}`, {
        left: x * unit,
        top: y * unit,
        width: unit,
        height: unit,
        background: color,
      }))}
    </div>
  );
}

function PixelCat({ left, top, scale = 8 }: { left: number; top: number; scale?: number }) {
  const rows = [
    '010000000010',
    '011000000110',
    '011100001110',
    '011111111110',
    '111111111111',
    '111201120111',
    '111221122111',
    '133113311331',
    '111111111111',
    '111111111111',
    '011111111110',
    '001111111100',
  ];
  const colors: Record<string, string> = {
    '1': '#ffc9a3',
    '2': ink,
    '3': pinkStrong,
  };
  return (
    <div style={{ position: 'absolute', left, top, width: 12 * scale, height: 12 * scale, display: 'flex' }}>
      {rows.flatMap((row, y) => row.split('').map((cell, x) => (
        cell === '0' ? null : rect(`cat-${x}-${y}`, {
          left: x * scale,
          top: y * scale,
          width: scale,
          height: scale,
          background: colors[cell],
        })
      )))}
    </div>
  );
}

function Card({ left, top, rank, suit, accent = pinkStrong }: { left: number; top: number; rank: string; suit: string; accent?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: 116,
        height: 162,
        display: 'flex',
        background: white,
        border: `6px solid ${ink}`,
      }}
    >
      <div style={{ position: 'absolute', left: 10, top: 8, display: 'flex', color: accent, fontSize: 34, fontWeight: 800, lineHeight: 1 }}>
        {rank}
      </div>
      <div style={{ position: 'absolute', left: 40, top: 58, display: 'flex', color: accent, fontSize: 58, fontWeight: 900, lineHeight: 1 }}>
        {suit}
      </div>
      <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', background: ink, color: white, padding: '3px 8px', fontSize: 24, lineHeight: 1 }}>
        {rank}
      </div>
    </div>
  );
}

function CardStack() {
  return (
    <div style={{ position: 'absolute', right: 98, top: 145, width: 330, height: 265, display: 'flex' }}>
      {rect('stack-shadow', { left: 22, top: 26, width: 224, height: 170, background: 'rgba(69,57,80,0.18)' })}
      <div style={{ position: 'absolute', left: 0, top: 30, width: 116, height: 162, display: 'flex', background: lavStrong, border: `6px solid ${ink}` }}>
        {rect('back-a', { left: 14, top: 14, width: 76, height: 114, border: `6px solid ${white}` })}
        {rect('back-b', { left: 38, top: 50, width: 34, height: 34, background: white })}
      </div>
      <Card left={78} top={0} rank="K" suit="♥" accent={pinkDeep} />
      <Card left={156} top={52} rank="10" suit="♦" accent={pinkStrong} />
      <div style={{ position: 'absolute', left: 252, top: 95, width: 54, height: 54, display: 'flex' }}>
        {rect('snap-h', { left: 0, top: 20, width: 54, height: 14, background: butterDeep })}
        {rect('snap-v', { left: 20, top: 0, width: 14, height: 54, background: butterDeep })}
      </div>
    </div>
  );
}

export function SocialPreview({ kind, width, height }: SocialPreviewProps) {
  const isTwitter = kind === 'twitter';
  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        background: sky,
        color: ink,
        fontFamily: 'Courier New, monospace',
      }}
    >
      <Checker width={width} height={height} />
      {rect('wash', { inset: 0, background: 'rgba(253,243,236,0.74)' })}
      {rect('mint-band', { left: 0, bottom: 0, width, height: isTwitter ? 170 : 150, background: mint })}
      {rect('pink-panel', { left: 66, top: 52, width: width - 132, height: height - 104, background: bg, border: `8px solid ${ink}` })}
      {rect('panel-shadow', { left: 82, top: 68, width: width - 132, height: height - 104, borderRight: `8px solid rgba(69,57,80,0.22)`, borderBottom: `8px solid rgba(69,57,80,0.22)` })}

      <PixelSparkle left={105} top={95} size={54} />
      <PixelSparkle left={width - 178} top={70} size={38} color={lavStrong} />
      <PixelSparkle left={width - 230} top={height - 145} size={42} color={pinkDeep} />
      <PixelCat left={112} top={height - 190} scale={8} />

      <div style={{ position: 'absolute', left: 132, top: 128, width: 560, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', color: pinkDeep, fontSize: 122, lineHeight: 0.88, fontWeight: 900, letterSpacing: 0 }}>
          cabo!
        </div>
        <div style={{ marginTop: 28, display: 'flex', color: ink, fontSize: 42, lineHeight: 1.08, fontWeight: 800 }}>
          pastel pixel card chaos
        </div>
        <div style={{ marginTop: 22, display: 'flex', color: inkSoft, fontSize: 31, lineHeight: 1.15, width: 480 }}>
          share a code, peek fast, snap faster, call cabo.
        </div>
      </div>

      <CardStack />
    </div>
  );
}
