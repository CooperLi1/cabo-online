'use strict';

const SOCIAL_REACTIONS = Object.freeze([
  { value: 'wave', glyph: '👋', label: 'hello' },
  { value: 'heart', glyph: '💖', label: 'love it' },
  { value: 'laugh', glyph: '😆', label: 'laugh' },
  { value: 'shock', glyph: '😱', label: 'shocked' },
  { value: 'fire', glyph: '🔥', label: 'on fire' },
  { value: 'cry', glyph: '😭', label: 'crying' },
  { value: 'clown', glyph: '🤡', label: 'clown' },
  { value: 'skull', glyph: '💀', label: 'skull' },
]);

const SOCIAL_PHRASES = Object.freeze([
  'good luck!',
  'nice snap!',
  'so close!',
  'gg!',
  'nice try!',
  'skill issue.',
]);

const reactionValues = new Set(SOCIAL_REACTIONS.map((reaction) => reaction.value));
const phraseValues = new Set(SOCIAL_PHRASES);

function normalizeSocialPayload(data) {
  if (!data || typeof data !== 'object') return null;
  const { kind, value } = data;
  if (typeof value !== 'string') return null;
  if (kind === 'reaction' && reactionValues.has(value)) return { kind, value };
  if (kind === 'chat' && phraseValues.has(value)) return { kind, value };
  return null;
}

module.exports = { SOCIAL_REACTIONS, SOCIAL_PHRASES, normalizeSocialPayload };
