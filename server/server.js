#!/usr/bin/env node
// Simulated building concierge service.
// - Serves the resident app (from ../) at http://127.0.0.1:8124/
// - Serves the concierge console at http://127.0.0.1:8124/admin
// - REST API under /api/... plus live events via SSE (/api/events)
// - Streams simulated real-time intercom audio (/api/visitors/:id/audio)
// No external dependencies. Loopback-only by default.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8124);
const HOST = process.env.HOST || "127.0.0.1";
const APP_DIR = path.join(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// ------------------------------- state -------------------------------------

const state = {
  resident: null,
  visitor: null,
  packages: [],
  decisions: [],
};

const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}
const crypto = require("crypto");

function defaultPhoto(label) {
  const esc = String(label).replace(/[<>&]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='#2b3a67'/><stop offset='1' stop-color='#16213e'/>
    </linearGradient></defs>
    <rect width='320' height='320' fill='url(#g)'/>
    <circle cx='160' cy='130' r='60' fill='#4d8dff'/>
    <path d='M80 320 a80 90 0 0 1 160 0 z' fill='#e8ecf4'/>
    <text x='160' y='55' font-family='sans-serif' font-size='20' fill='#e8ecf4'
      text-anchor='middle'>${esc}</text>
  </svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// ------------------------------ helpers ------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
}

// ----------------------- simulated live audio (WAV) --------------------------

// Streams 8 kHz 16-bit mono PCM shaped like intercom chatter:
// two drone tones amplitude-gated by a slow envelope plus a touch of noise.
function streamVisitorAudio(req, res) {
  const SAMPLE_RATE = 8000;
  const CHUNK_SAMPLES = 4000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(0x7ffff000, 4); // large declared size: streams indefinitely
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(0x7fffe000, 40);

  res.writeHead(200, {
    "Content-Type": "audio/wav",
    "Cache-Control": "no-store",
    "Transfer-Encoding": "chunked",
  });
  res.write(header);

  let t = 0;
  const timer = setInterval(() => {
    if (res.destroyed) return clearInterval(timer);
    const chunk = Buffer.alloc(CHUNK_SAMPLES * 2);
    for (let i = 0; i < CHUNK_SAMPLES; i++) {
      t += 1 / SAMPLE_RATE;
      const gate = Math.max(0, Math.sin(t * 1.4)) ** 3; // speech-like bursts
      const s =
        0.25 * Math.sin(2 * Math.PI * 220 * t) * gate +
        0.15 * Math.sin(2 * Math.PI * 330 * t) * gate +
        0.02 * (Math.random() * 2 - 1);
      chunk.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2);
    }
    res.write(chunk);
  }, (CHUNK_SAMPLES / SAMPLE_RATE) * 1000);

  req.on("close", () => clearInterval(timer));
}

// ------------------------------- API ---------------------------------------

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  if (p === "/api/events" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(":ok\n\n");
    sseClients.add(res);
    const hb = setInterval(() => {
      if (res.destroyed) return clearInterval(hb);
      res.write(":hb\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(hb);
      sseClients.delete(res);
    });
    return;
  }

  if (p === "/api/residents" && method === "POST") {
    const body = await readBody(req);
    if (!body.anonymous && !body.name && !body.flat) {
      return sendJson(res, 400, { error: "name and flat required" });
    }
    state.resident = { ...body, residentId: genId(), registeredAt: new Date().toISOString() };
    console.log(`[concierge] resident registered: ${JSON.stringify(state.resident)}`);
    broadcast("resident", state.resident);
    return sendJson(res, 200, {
      residentId: state.resident.residentId,
      registeredAt: state.resident.registeredAt,
    });
  }

  if (p === "/api/visitors/alerts" && method === "GET") {
    return sendJson(res, 200, state.visitor);
  }

  if (p.startsWith("/api/visitors/") && p.endsWith("/decision") && method === "POST") {
    const id = decodeURIComponent(p.split("/")[3]);
    if (!state.visitor || state.visitor.id !== id) {
      return sendJson(res, 404, { error: "no such active visitor" });
    }
    const body = await readBody(req);
    const approve = Boolean(body.approve);
    state.visitor.status = approve ? "approved" : "denied";
    state.visitor.decidedAt = new Date().toISOString();
    state.decisions.unshift({
      visitor: state.visitor.name,
      approve,
      decidedAt: state.visitor.decidedAt,
    });
    console.log(`[concierge] resident ${approve ? "APPROVED" : "DENIED"} visitor: ${state.visitor.name}`);
    broadcast("visitor", state.visitor);
    const cleared = state.visitor;
    state.visitor = null;
    broadcast("cleared", cleared);
    return sendJson(res, 200, cleared);
  }

  if (p.startsWith("/api/visitors/") && p.endsWith("/audio") && method === "GET") {
    return streamVisitorAudio(req, res);
  }

  if (p === "/api/packages" && method === "GET") {
    return sendJson(res, 200, state.packages);
  }

  // ----- concierge (admin) actions -----

  if (p === "/api/concierge/visitor" && method === "POST") {
    const body = await readBody(req);
    if (state.visitor) return sendJson(res, 409, { error: "a visitor is already waiting" });
    if (!body.name) return sendJson(res, 400, { error: "visitor name required" });
    state.visitor = {
      id: genId(),
      name: body.name,
      photo: body.photo || defaultPhoto(body.name.toUpperCase().slice(0, 12)),
      message: body.message || `A visitor states they are here for your flat.`,
      arrivedAt: new Date().toISOString(),
      status: "pending",
    };
    console.log(`[concierge] visitor announced: ${state.visitor.name}`);
    broadcast("visitor", state.visitor);
    return sendJson(res, 200, state.visitor);
  }

  if (p === "/api/concierge/package" && method === "POST") {
    const body = await readBody(req);
    const pkg = {
      id: genId(),
      courier: body.courier || "Unknown courier",
      note: body.note || "Package dropped off at the concierge desk.",
      droppedAt: new Date().toISOString(),
    };
    state.packages.unshift(pkg);
    console.log(`[concierge] package dropped off: ${pkg.courier}`);
    broadcast("packages", state.packages);
    return sendJson(res, 200, pkg);
  }

  if (p === "/api/concierge/state" && method === "GET") {
    return sendJson(res, 200, state);
  }

  sendJson(res, 404, { error: "not found", path: p });
}

// ------------------------------ server --------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  Promise.resolve()
    .then(async () => {
      if (p.startsWith("/api/")) return handleApi(req, res, url);
      if (p === "/admin" || p === "/admin/") return serveStatic(res, path.join(__dirname, "admin.html"));
      if (p === "/") return serveStatic(res, path.join(APP_DIR, "index.html"));
      const safe = path.normalize(p).replace(/^([/\\])+/, "");
      return serveStatic(res, path.join(APP_DIR, safe));
    })
    .catch((err) => {
      console.error("[concierge] error:", err.message);
      if (!res.headersSent) sendJson(res, 400, { error: err.message });
      else res.end();
    });
});

server.listen(PORT, HOST, () => {
  console.log(`Concierge service running at http://${HOST}:${PORT}`);
  console.log(`  resident app : http://${HOST}:${PORT}/`);
  console.log(`  concierge    : http://${HOST}:${PORT}/admin`);
});
