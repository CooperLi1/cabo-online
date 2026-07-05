'use client';
import { memo } from 'react';
import { motion } from 'motion/react';
import type { CardInfo } from '@/lib/types';
import { cardValue } from '@/lib/types';
import { PixelSuit, PixelSprite, PixelText, SPARKLE } from './PixelSprite';

const SUIT_COLOR: Record<string, string> = {
  '♥': '#ff6e8c',
  '♦': '#ff6e8c',
  '♣': '#5d5a88',
  '♠': '#5d5a88',
  '★': '#a98fe8',
};

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';
const SIZE_W: Record<CardSize, number> = { xs: 36, sm: 48, md: 60, lg: 78 };

export const PlayingCard = memo(function PlayingCard({
  id,
  card,
  size = 'md',
  onClick,
  selectable,
  selected,
  seen,
  dimmed,
  wobble,
  noLayout,
  title,
}: {
  id: string;
  card?: CardInfo | null; // known face → face up; null/undefined → face down
  size?: CardSize;
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  seen?: boolean; // you peeked this card earlier (sparkle hint, value NOT shown)
  dimmed?: boolean;
  wobble?: boolean;
  noLayout?: boolean;
  title?: string;
}) {
  const faceUp = !!card;
  const w = SIZE_W[size];
  const color = card ? SUIT_COLOR[card.s] : '#5d5a88';
  const rankLabel = card ? (card.r === 'X' ? '' : card.r) : '';
  return (
    <motion.div
      layoutId={noLayout ? undefined : `card-${id}`}
      layout={!noLayout}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      className={[
        'pcard',
        `pcard-${size}`,
        selectable ? 'pcard-selectable' : '',
        selected ? 'pcard-selected' : '',
        dimmed ? 'pcard-dimmed' : '',
        wobble ? 'pcard-wobble' : '',
      ].join(' ')}
      onClick={onClick}
      whileTap={onClick ? { scale: 0.92 } : undefined}
      title={title}
      data-cardid={id}
    >
      <motion.div
        className="pcard-inner"
        initial={false}
        animate={{ rotateY: faceUp ? 0 : 180 }}
        transition={{ duration: 0.4, ease: [0.4, 0.1, 0.2, 1] }}
      >
        <div className="pcard-face pcard-front" style={{ color }}>
          {card && (
            <>
              {rankLabel && (
                <span className="pcard-corner">
                  <PixelText text={rankLabel} height={w * 0.24} color={color} />
                </span>
              )}
              {card.r === 'X' ? (
                <PixelSuit suit="★" size={w * 0.5} color={color} className="pcard-pip" />
              ) : (
                <PixelSuit suit={card.s} size={w * 0.44} color={color} className="pcard-pip" />
              )}
              <span className="pcard-value">
                <PixelText text={String(cardValue(card))} height={w * 0.13} color="#fffdfa" />
              </span>
            </>
          )}
        </div>
        <div className="pcard-face pcard-back">
          <PixelSprite grid={SPARKLE} color="#fffdfa" size={w * 0.34} />
          {seen && (
            <span className="pcard-seen" title="you saw this card">
              <PixelSprite grid={SPARKLE} color="#f5c94f" size={w * 0.28} />
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
});
