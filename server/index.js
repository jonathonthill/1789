// Régicide 1789 — server: Express static hosting + Socket.IO rooms.
// Server-authoritative: clients send intents; each player receives only their own view.
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import * as engine from '../shared/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const rooms = new Map(); // code -> room

// Unambiguous alphabet (no O/I/0/1 lookalikes)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('no codes free');
}

function makeRoom(hostName) {
  const code = newCode();
  const room = {
    code,
    status: 'lobby', // lobby | playing | ended
    players: [],     // { token, name, socketId|null }
    state: null,
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  addPlayer(room, hostName);
  return room;
}

function addPlayer(room, name) {
  const token = crypto.randomBytes(16).toString('hex');
  const player = { token, name: sanitizeName(name), socketId: null };
  room.players.push(player);
  return player;
}

function sanitizeName(name) {
  const n = String(name ?? '').trim().slice(0, 16);
  return n || 'Citoyen';
}

function touch(room) { room.lastActivity = Date.now(); }

function playerIndex(room, token) {
  return room.players.findIndex(p => p.token === token);
}

function lobbyView(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map((p, i) => ({ name: p.name, connected: !!p.socketId, host: i === 0 })),
  };
}

function broadcastLobby(room) {
  room.players.forEach((p, i) => {
    if (p.socketId) io.to(p.socketId).emit('lobby', { ...lobbyView(room), yourIndex: i, youAreHost: i === 0 });
  });
}

function broadcastState(room) {
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (!p.socketId) continue;
    const view = engine.viewFor(room.state, i);
    view.connections = room.players.map(q => !!q.socketId);
    view.roomCode = room.code;
    view.status = room.status;
    io.to(p.socketId).emit('state', view);
  }
}

io.on('connection', socket => {
  let myRoom = null;
  let myToken = null;

  const unbind = () => {
    // One socket, one seat: release any seat this socket previously held
    if (!myRoom) return;
    const idx = playerIndex(myRoom, myToken);
    if (idx !== -1 && myRoom.players[idx].socketId === socket.id) myRoom.players[idx].socketId = null;
  };
  const bind = (room, token) => {
    unbind();
    myRoom = room;
    myToken = token;
    const idx = playerIndex(room, token);
    clearTimeout(room.players[idx].dropTimer);
    room.players[idx].socketId = socket.id;
  };

  socket.on('create', ({ name }, cb) => {
    try {
      const room = makeRoom(name);
      bind(room, room.players[0].token);
      cb({ ok: true, code: room.code, token: room.players[0].token, playerIndex: 0 });
      broadcastLobby(room);
    } catch (e) { cb({ ok: false, error: 'Could not open a salon. Try again.' }); }
  });

  socket.on('join', ({ code, name }, cb) => {
    const room = rooms.get(String(code ?? '').toUpperCase().trim());
    if (!room) return cb({ ok: false, error: 'No such salon. Check the code.' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'That game has already begun.' });
    if (room.players.length >= 4) return cb({ ok: false, error: 'The salon is full (4 citoyens).' });
    touch(room);
    const player = addPlayer(room, name);
    bind(room, player.token);
    cb({ ok: true, code: room.code, token: player.token, playerIndex: room.players.length - 1 });
    broadcastLobby(room);
  });

  socket.on('rejoin', ({ code, token }, cb) => {
    const room = rooms.get(String(code ?? '').toUpperCase().trim());
    if (!room) return cb({ ok: false, error: 'That salon has dissolved.' });
    const idx = playerIndex(room, token);
    if (idx === -1) return cb({ ok: false, error: 'You are not known in that salon.' });
    touch(room);
    // Displace any stale socket for this seat.
    bind(room, token);
    cb({ ok: true, code: room.code, playerIndex: idx, name: room.players[idx].name, status: room.status });
    if (room.status === 'lobby') broadcastLobby(room);
    else { broadcastState(room); }
  });

  socket.on('start', (_, cb) => {
    const room = myRoom;
    if (!room || playerIndex(room, myToken) !== 0) return cb?.({ ok: false, error: 'Only the host may start.' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Already begun.' });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'At least 2 citoyens needed. For solo, use Solo mode.' });
    touch(room);
    room.state = engine.newGame(room.players.map(p => p.name));
    room.status = 'playing';
    cb?.({ ok: true });
    broadcastState(room);
  });

  socket.on('action', (msg, cb) => {
    const room = myRoom;
    if (!room || room.status !== 'playing') return cb?.({ ok: false, error: 'No game in progress.' });
    const idx = playerIndex(room, myToken);
    if (idx === -1) return cb?.({ ok: false, error: 'Unknown player.' });
    touch(room);
    const s = room.state;
    try {
      switch (msg?.type) {
        case 'play': engine.playCards(s, idx, msg.cards ?? []); break;
        case 'yield': engine.yieldTurn(s, idx); break;
        case 'discard': engine.discardForDamage(s, idx, msg.cards ?? []); break;
        case 'chooseNext': engine.chooseNext(s, idx, msg.target); break;
        default: return cb?.({ ok: false, error: 'Unknown action.' });
      }
      if (s.phase === 'won' || s.phase === 'lost') room.status = 'ended';
      cb?.({ ok: true });
      broadcastState(room);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on('rematch', (_, cb) => {
    const room = myRoom;
    if (!room || room.status !== 'ended') return cb?.({ ok: false, error: 'Nothing to rematch.' });
    touch(room);
    room.state = engine.newGame(room.players.map(p => p.name));
    room.status = 'playing';
    cb?.({ ok: true });
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const room = myRoom;
    if (!room) return;
    const idx = playerIndex(room, myToken);
    if (idx !== -1 && room.players[idx].socketId === socket.id) {
      const player = room.players[idx];
      player.socketId = null;
      if (room.status === 'lobby') {
        // Non-hosts get a 30s grace to reconnect before losing their lobby seat
        // (a network blip should not kick anyone).
        if (idx !== 0) {
          player.dropTimer = setTimeout(() => {
            if (!player.socketId && room.status === 'lobby') {
              const i = room.players.indexOf(player);
              if (i > 0) { room.players.splice(i, 1); broadcastLobby(room); }
            }
          }, 30_000);
          player.dropTimer.unref?.();
        }
        broadcastLobby(room);
      } else {
        broadcastState(room); // shows the paused/disconnected banner
      }
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}, 10 * 60 * 1000).unref();

const PORT = process.env.PORT || 3789;
server.listen(PORT, () => {
  console.log(`1789 — listening on http://localhost:${PORT}`);
  console.log('For LAN play, share your local IP, e.g. http://<your-ip>:' + PORT);
});
