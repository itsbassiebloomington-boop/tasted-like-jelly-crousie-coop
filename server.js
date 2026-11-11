const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.get("/", (_req, res) => res.json({
  name: "Tasted like Jelly Co-op Server",
  status: "online"
}));
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 5e6
});

const rooms = new Map();
const MAX_PLAYERS = 8;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  let code;
  do {
    const bytes = crypto.randomBytes(6);
    code = Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join("");
  } while (rooms.has(code));
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, ready: p.ready, isHost: p.id === room.hostId
    })),
    maxPlayers: MAX_PLAYERS
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room-updated", publicRoom(room));
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;

  room.players.delete(socket.id);
  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
  }
  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("create-room", ({ name } = {}, reply = () => {}) => {
    leaveCurrentRoom(socket);
    const code = makeCode();
    const player = {
      id: socket.id,
      name: String(name || "Host").slice(0, 20),
      ready: false
    };
    const room = {
      code,
      hostId: socket.id,
      players: new Map([[socket.id, player]])
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    reply({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("join-room", ({ code, name } = {}, reply = () => {}) => {
    const normalized = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const room = rooms.get(normalized);
    if (!room) return reply({ ok: false, error: "Room not found." });
    if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: "Room is full." });
    leaveCurrentRoom(socket);
    room.players.set(socket.id, {
      id: socket.id,
      name: String(name || "Player").slice(0, 20),
      ready: false
    });
    socket.join(normalized);
    socket.data.roomCode = normalized;
    reply({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("set-ready", ({ ready } = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return reply({ ok: false, error: "You are not in a room." });
    const player = room.players.get(socket.id);
    if (!player) return reply({ ok: false, error: "Player not found." });
    player.ready = Boolean(ready);
    emitRoom(room);
    reply({ ok: true });
  });

  socket.on("leave-room", (_payload, reply = () => {}) => {
    leaveCurrentRoom(socket);
    reply({ ok: true });
  });

  socket.on("disconnect", () => leaveCurrentRoom(socket));
});

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`Tasted like Jelly Co-op server listening on ${port}`);
});
