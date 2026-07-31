// Régicide 1789 — server: Express static hosting + Socket.IO rooms.
// Server-authoritative: clients send intents; each player receives only their own view.
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import * as engine from '../shared/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

// ---- build stamp -----------------------------------------------------------
// Everything the browser downloads, fingerprinted by size and mtime at boot.
// The page is stamped with it and asks /version whether it has fallen behind —
// mobile Safari is otherwise happy to sit on a cached build indefinitely.
function buildInfo() {
  const h = crypto.createHash('sha1');
  let updatedAt = 0;
  const walk = dir => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const st = fs.statSync(p);
      updatedAt = Math.max(updatedAt, st.mtimeMs);
      h.update(`${path.relative(__dirname, p)}:${st.size}:${st.mtimeMs}\n`);
    }
  };
  try { walk(PUBLIC_DIR); walk(SHARED_DIR); } catch { /* stamp what we can read */ }
  return {
    build: h.digest('hex').slice(0, 12),
    updatedAt: new Date(updatedAt || Date.now()).toISOString(),
  };
}
const { build: BUILD, updatedAt: UPDATED_AT } = buildInfo();

// The entry document is never cached: it carries the stamp every other
// freshness check is measured against, so a stale copy would defeat the lot.
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replaceAll('__BUILD__', BUILD)
  .replaceAll('__UPDATED_AT__', UPDATED_AT);
app.get(['/', '/index.html'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(INDEX_HTML);
});
app.get('/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ build: BUILD, updatedAt: UPDATED_AT });
});

// Code revalidates on every request (cheap — an unchanged file answers 304);
// the paintings, audio and cutscenes are large and change rarely, so they get
// an hour before the browser asks again.
const CODE = /\.(?:html|js|mjs|css|json|map)$/i;
const cacheHeaders = (res, filePath) => {
  res.setHeader('Cache-Control', CODE.test(filePath) ? 'no-cache' : 'public, max-age=3600');
};
app.use(express.static(PUBLIC_DIR, { setHeaders: cacheHeaders }));
app.use('/shared', express.static(SHARED_DIR, { setHeaders: cacheHeaders }));

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
    rules: { ...engine.DEFAULT_RULES }, // La Constitution, as set by the host
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
    rules: room.rules,
    // What those rules actually mean for the table as it currently stands, so
    // joiners see real numbers rather than "rulebook".
    resolvedRules: engine.resolveRules(room.rules, Math.max(1, room.players.length)),
    players: room.players.map((p, i) => ({ name: p.name, connected: !!p.socketId, host: i === 0 })),
  };
}

// Seats currently holding a live socket — l'Assemblée counts only these.
function connectedSeats(room) {
  return room.players.map((p, i) => (p.socketId ? i : -1)).filter(i => i >= 0);
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
    view.youAreHost = i === 0;
    io.to(p.socketId).emit('state', view);
  }
}

// A seat changing hands can settle an open motion — a dropped voter leaves the
// floor, and the remaining tally may already carry. That can even end the game,
// so the room status has to follow.
function syncAndBroadcast(room) {
  if (room.status === 'playing' && room.state) {
    engine.syncAssembly(room.state, connectedSeats(room));
    if (room.state.phase === 'won' || room.state.phase === 'lost') room.status = 'ended';
  }
  broadcastState(room);
}

// Hosting is an administrative role, not a permanent first-player advantage.
// Draw a fresh starter for the opening game and every rematch.
function newRoomGame(room) {
  return engine.newGame(room.players.map(p => p.name), {
    rules: room.rules,
    startingPlayer: crypto.randomInt(room.players.length),
  });
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

  socket.on('create', ({ name, rules }, cb) => {
    try {
      const room = makeRoom(name);
      if (rules) room.rules = { ...engine.DEFAULT_RULES, ...rules };
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
    else { syncAndBroadcast(room); }
  });

  // The host may revise La Constitution right up until the Revolution begins.
  socket.on('rules', ({ rules }, cb) => {
    const room = myRoom;
    if (!room || playerIndex(room, myToken) !== 0) return cb?.({ ok: false, error: 'Only the host may set the rules.' });
    if (room.status === 'playing') return cb?.({ ok: false, error: 'The rules are set for this game.' });
    touch(room);
    room.rules = { ...engine.DEFAULT_RULES, ...(rules ?? {}) };
    cb?.({ ok: true });
    broadcastLobby(room);
  });

  socket.on('start', (_, cb) => {
    const room = myRoom;
    if (!room || playerIndex(room, myToken) !== 0) return cb?.({ ok: false, error: 'Only the host may start.' });
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Already begun.' });
    if (room.players.length < 2) return cb?.({ ok: false, error: 'At least 2 citoyens needed. For solo, use Solo mode.' });
    touch(room);
    room.state = newRoomGame(room);
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
        case 'assembly': engine.callAssembly(s, idx, connectedSeats(room)); break;
        case 'vote': engine.castVote(s, idx, !!msg.aye); break;
        case 'surrender': engine.surrenderGame(s, idx); break;
        default: return cb?.({ ok: false, error: 'Unknown action.' });
      }
      if (s.phase === 'won' || s.phase === 'lost') room.status = 'ended';
      cb?.({ ok: true });
      broadcastState(room);
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  // Host-only, because a rematch carries a fresh Constitution with it.
  socket.on('rematch', ({ rules } = {}, cb) => {
    const room = myRoom;
    if (!room || room.status !== 'ended') return cb?.({ ok: false, error: 'Nothing to rematch.' });
    if (playerIndex(room, myToken) !== 0) return cb?.({ ok: false, error: 'Only the host may call the next game.' });
    touch(room);
    if (rules) room.rules = { ...engine.DEFAULT_RULES, ...rules };
    room.state = newRoomGame(room);
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
        syncAndBroadcast(room); // shows the paused/disconnected banner
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
  console.log(`1789 — build ${BUILD} — listening on http://localhost:${PORT}`);
  console.log('For LAN play, share your local IP, e.g. http://<your-ip>:' + PORT);
});
