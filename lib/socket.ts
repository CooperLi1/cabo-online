'use client';
import { io, Socket } from 'socket.io-client';
import { LocalGameSocket } from './localGame';

let socket: Socket | null = null;
let localSocket: LocalGameSocket | null = null;
let localMode = false;

// offline practice mode: the whole game engine runs in this tab, so the
// "socket" is an in-memory shim with the same on/off/emit shape
export function setLocalMode(on: boolean) {
  localMode = on;
  if (on && !localSocket) localSocket = new LocalGameSocket();
  if (!on) localSocket?.emit('leave');
}

export function isLocalMode() {
  return localMode;
}

export function getSocket(): Socket {
  if (localMode) return localSocket as unknown as Socket;
  if (!socket) {
    // same-origin by default; set NEXT_PUBLIC_SOCKET_URL to run the game
    // server on a different host than the UI (e.g. UI on Vercel, game
    // server on Railway/Render/Fly)
    const url = process.env.NEXT_PUBLIC_SOCKET_URL;
    socket = url
      ? io(url, { transports: ['websocket', 'polling'] })
      : io({ transports: ['websocket', 'polling'] });
    // report round-trip time so the server can latency-compensate snap races
    const probe = () => {
      if (!socket || !socket.connected) return;
      const t0 = performance.now();
      socket.emit('pingx', 0, () => {
        socket!.emit('rtt', performance.now() - t0);
      });
    };
    socket.on('connect', () => {
      probe();
    });
    setInterval(probe, 4000);
  }
  return socket;
}
