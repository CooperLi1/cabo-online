'use strict';
// Custom server: Next.js app + Socket.IO on one port.
// All game rules live in lib/game.js; this file only wires sockets to rooms.

const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');
const { createRoom, getRoom } = require('./lib/game');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, {
    serveClient: false,
    // allow a split deployment where the UI lives on another origin
    cors: { origin: process.env.CORS_ORIGIN || '*' },
  });

  const emitFactory = (code) => ({
    toRoom: (event, payload) => io.to(code).emit(event, payload),
    toPlayer: (player, event, payload) => {
      if (player.socketId) io.to(player.socketId).emit(event, payload);
    },
  });

  io.on('connection', (socket) => {
    socket.data.rtt = 100;

    const ctx = () => {
      const room = socket.data.code ? getRoom(socket.data.code) : null;
      const player = room && socket.data.token ? room.playerByToken(socket.data.token) : null;
      return { room, player };
    };

    const bind = (room, player) => {
      socket.data.code = room.code;
      socket.data.token = player.token;
      player.socketId = socket.id;
      player.connected = true;
      socket.join(room.code);
    };

    socket.on('create', ({ name, avatar, turnMs }, cb) => {
      const room = createRoom(emitFactory);
      const player = room.addPlayer({ name, avatar });
      if (typeof turnMs === 'number') room.setTurnMs(player, turnMs);
      bind(room, player);
      cb({ ok: true, code: room.code, token: player.token, pid: player.pid });
      room.broadcast();
    });

    socket.on('join', ({ code, name, avatar, token }, cb) => {
      const room = getRoom(code);
      if (!room) return cb({ error: 'No game with that code' });
      const player = room.addPlayer({ name, avatar, token });
      if (player.error) return cb(player);
      bind(room, player);
      cb({ ok: true, code: room.code, token: player.token, pid: player.pid });
      room.broadcast();
    });

    socket.on('rejoin', ({ code, token }, cb) => {
      const room = getRoom(code);
      const player = room && room.playerByToken(token);
      if (!room || !player) return cb({ error: 'Could not rejoin' });
      bind(room, player);
      cb({ ok: true, code: room.code, token: player.token, pid: player.pid });
      room.broadcast();
    });

    socket.on('leave', () => {
      const { room, player } = ctx();
      if (room && player) room.removePlayer(player);
      socket.data.code = null;
      socket.data.token = null;
    });

    // latency probe — client sends this every few seconds
    socket.on('pingx', (t, cb) => {
      if (typeof cb === 'function') cb(t);
    });
    socket.on('rtt', (ms) => {
      if (typeof ms === 'number' && ms >= 0 && ms < 2000) {
        socket.data.rtt = socket.data.rtt * 0.6 + ms * 0.4;
      }
    });

    const acts = {
      start: (room, p) => room.start(p),
      peek: (room, p, d) => room.peek(p, d.cardId),
      drawStock: (room, p) => room.drawStock(p),
      drawDiscard: (room, p) => room.drawDiscard(p),
      swapDrawn: (room, p, d) => room.swapDrawn(p, d.cardId),
      discardDrawn: (room, p) => room.discardDrawn(p),
      usePower: (room, p, d) => room.usePower(p, d),
      skipPower: (room, p) => room.skipPower(p),
      callCabo: (room, p) => room.callCabo(p),
      give: (room, p, d) => room.giveCard(p, d.cardId),
      addBot: (room, p, d) => room.addBot(p, d.level),
      removeBot: (room, p, d) => room.removeBot(p, d.pid),
      setTurnMs: (room, p, d) => room.setTurnMs(p, d.turnMs),
    };
    for (const [name, fn] of Object.entries(acts)) {
      socket.on(name, (data) => {
        const { room, player } = ctx();
        if (room && player) fn(room, player, data || {});
      });
    }

    socket.on('snap', (data) => {
      const { room, player } = ctx();
      if (room && player && data && data.cardId) {
        room.snap(player, data.cardId, socket.data.rtt,
          typeof data.reaction === 'number' ? data.reaction : null);
      }
    });

    socket.on('disconnect', () => {
      const { room, player } = ctx();
      if (room && player && player.socketId === socket.id) {
        player.socketId = null;
        room.removePlayer(player);
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`> cabo ready on http://localhost:${port} (${dev ? 'dev' : 'prod'})`);
  });
});
