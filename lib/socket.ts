'use client';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
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
