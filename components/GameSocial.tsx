'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { SocialMessage } from '@/lib/types';
import { getSocket } from '@/lib/socket';
import { sfx } from '@/lib/sounds';
import { SOCIAL_PHRASES, SOCIAL_REACTIONS } from '@/lib/social.js';

const MESSAGE_MS = 3000;
const SEND_COOLDOWN_MS = 900;
const REACTION_GLYPHS = new Map(SOCIAL_REACTIONS.map((reaction) => [reaction.value, reaction.glyph]));

export function useGameSocial(code: string) {
  const [messages, setMessages] = useState<Record<string, SocialMessage>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const socket = getSocket();
    const activeTimers = timers.current;
    setMessages({});
    const onSocial = (message: SocialMessage) => {
      if (message.code !== code) return;
      const oldTimer = activeTimers.get(message.pid);
      if (oldTimer) clearTimeout(oldTimer);
      setMessages((current) => ({ ...current, [message.pid]: message }));
      sfx.social();
      activeTimers.set(message.pid, setTimeout(() => {
        activeTimers.delete(message.pid);
        setMessages((current) => {
          if (current[message.pid]?.id !== message.id) return current;
          const next = { ...current };
          delete next[message.pid];
          return next;
        });
      }, MESSAGE_MS));
    };

    socket.on('social', onSocial);
    return () => {
      socket.off('social', onSocial);
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
    };
  }, [code]);

  return messages;
}

export const GameSocialControl = memo(function GameSocialControl({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  return (
    <button
      ref={trigger}
      className={`btn btn-small btn-round social-trigger ${open ? 'social-trigger-open' : ''}`}
      onClick={() => onOpenChange(!open)}
      aria-label={open ? 'close quick chat' : 'open quick chat'}
      aria-expanded={open}
      title="quick chat"
    >
      {open ? '✕' : '💬'}
    </button>
  );
});

export const GameSocialRibbon = memo(function GameSocialRibbon({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const firstAction = useRef<HTMLButtonElement>(null);
  const cooldownUntil = useRef(0);
  const socket = getSocket();

  useEffect(() => {
    if (!open) return;
    firstAction.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const send = useCallback((kind: 'reaction' | 'chat', value: string) => {
    const now = performance.now();
    if (now < cooldownUntil.current) return;
    cooldownUntil.current = now + SEND_COOLDOWN_MS;
    socket.emit('social', { kind, value });
    onOpenChange(false);
  }, [onOpenChange, socket]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="social-ribbon-shell"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
          transition={{ duration: 0.16 }}
          aria-label="quick chat"
        >
          <div className="social-ribbon" role="group" aria-label="reactions and quick messages">
            {SOCIAL_REACTIONS.map((reaction, index) => (
              <button
                ref={index === 0 ? firstAction : undefined}
                key={reaction.value}
                className="social-reaction"
                onClick={() => send('reaction', reaction.value)}
                aria-label={reaction.label}
                title={reaction.label}
              >
                {reaction.glyph}
              </button>
            ))}
            <span className="social-ribbon-divider" aria-hidden="true" />
            {SOCIAL_PHRASES.map((phrase) => (
              <button key={phrase} className="social-phrase" onClick={() => send('chat', phrase)}>
                {phrase}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export const PlayerSocialBubble = memo(function PlayerSocialBubble({
  message,
  side,
  align,
}: {
  message?: SocialMessage;
  side: 'above' | 'below';
  align: 'left' | 'center' | 'right';
}) {
  const reduceMotion = useReducedMotion();
  const text = message?.kind === 'reaction' ? REACTION_GLYPHS.get(message.value) : message?.value;

  return (
    <AnimatePresence mode="wait">
      {message && text && (
        <motion.div
          key={message.id}
          className={`social-bubble social-bubble-${side} social-bubble-${align} ${message.kind === 'reaction' ? 'social-bubble-reaction' : 'social-bubble-chat'}`}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.72, y: side === 'above' ? 5 : -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.16 }}
          role="status"
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
