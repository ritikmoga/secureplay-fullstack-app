import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { URL } from "node:url";
import { config } from "./config.js";
import { store } from "./store.js";
import { createDemoSession, postureFromFirewall } from "./security.js";
import { runSimulation } from "./simulation.js";

const sessions = new Map();
const sseClients = new Set();
const rateBuckets = new Map();
const mutationBuckets = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

const nowIso = () => new Date().toISOString();
const sendJson = (res, status, payload, requestId) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Request-ID": requestId
  });
  res.end(body);
};
const ok = (res, data, requestId, status = 200) => sendJson(res, status, { ok: true, data, requestId }, requestId);
const fail = (res, status, code, message, requestId) => sendJson(res, status, { ok: false, error: { code, message }, requestId }, requestId);

function resolveClientIp(req) {
  if (config.trustProxy) return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  return req.socket.remoteAddress || "unknown";
}

function allowRate(map, key, limit, windowMs) {
  const now = Date.now();
  const current = map.get(key);
  if (!current || current.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Demo-Token,X-Request-ID");
  return true;
}

function readJson(req, maxBytes = 65_536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function validateSession(req) {
  const token = req.headers["x-demo-token"];
  const session = token ? sessions.get(String(token)) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(String(token));
    return null;
  }
  return session;
}

function createSession(requestId) {
  const created = createDemoSession(requestId);
  sessions.set(created.token, {
    id: created.id,
    expiresAt: new Date(created.expiresAt).getTime()
  });
  return created;
}

function validateSimulation(body) {
  const latency = Number(body.latency);
  const loss = Number(body.loss);
  const jitter = Number(body.jitter);
  const allowed = new Set(["duplicate", "reorder", "malformed", "flood"]);
  const conditions = Array.isArray(body.conditions) ? [...new Set(body.conditions)] : [];
  if (!Number.isInteger(latency) || latency < 0 || latency > 250) return { error: "Latency must be an integer from 0 to 250." };
  if (!Number.isFinite(loss) || loss < 0 || loss > 40) return { error: "Packet loss must be from 0 to 40." };
  if (!Number.isInteger(jitter) || jitter < 0 || jitter > 100) return { error: "Jitter must be an integer from 0 to 100." };
  if (conditions.length > 4 || conditions.some((item) => !allowed.has(item))) return { error: "One or more traffic conditions are invalid." };
  return { value: { latency, loss, jitter, conditions } };
}

function validateToggle(body) {
  return typeof body.enabled === "boolean" ? { value: body.enabled } : { error: "enabled must be a boolean." };
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify({ event, payload, sentAt: nowIso() })}\n\n`;
  for (const client of sseClients) {
    try { client.write(message); } catch { sseClients.delete(client); }
  }
}

function serveEventStream(req, res, requestId) {
  res.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Request-ID": requestId
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ event: "connected", payload: { posture: postureFromFirewall(store.getFirewall()), clients: sseClients.size + 1 }, sentAt: nowIso() })}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

async function serveStatic(req, res, pathname, requestId) {
  let requested = pathname === "/" ? "/index.html" : pathname;
  let filePath = path.resolve(config.publicDir, `.${requested}`);
  if (!filePath.startsWith(config.publicDir)) return fail(res, 403, "FORBIDDEN", "Invalid path.", requestId);

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(config.publicDir, "index.html");
  }

  try {
    const stat = await fs.promises.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypes[ext] || "application/octet-stream";
    const cacheControl = ext === ".html" ? "no-cache" : config.nodeEnv === "production" ? "public, max-age=3600" : "no-cache";
    const acceptsGzip = /gzip/.test(String(req.headers["accept-encoding"] || ""));
    const compressible = /^(text\/|application\/(json|javascript))/.test(contentType) && stat.size > 1024;

    res.writeHead(200, {
      ...securityHeaders,
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "ETag": `W/\"${stat.size}-${Math.floor(stat.mtimeMs)}\"`,
      ...(acceptsGzip && compressible ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : { "Content-Length": stat.size }),
      "X-Request-ID": requestId
    });
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    if (acceptsGzip && compressible) stream.pipe(zlib.createGzip()).pipe(res);
    else stream.pipe(res);
  } catch {
    fail(res, 404, "NOT_FOUND", "Resource not found.", requestId);
  }
}

const server = http.createServer(async (req, res) => {
  const startedAt = process.hrtime.bigint();
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
  res.setHeader("X-Request-ID", requestId);

  if (!applyCors(req, res)) return fail(res, 403, "ORIGIN_BLOCKED", "Origin not allowed.", requestId);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...securityHeaders, "X-Request-ID": requestId });
    return res.end();
  }

  const ip = resolveClientIp(req);
  if (!allowRate(rateBuckets, ip, 180, 60_000)) return fail(res, 429, "RATE_LIMITED", "Too many requests. Try again shortly.", requestId);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const isMutation = ["POST", "PUT", "DELETE"].includes(req.method || "");
  if (isMutation && !allowRate(mutationBuckets, ip, 45, 60_000)) return fail(res, 429, "MUTATION_RATE_LIMITED", "Too many state-changing requests.", requestId);

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      return ok(res, { status: "healthy", service: "secureplay-network-lab", version: "1.0.0", uptimeSeconds: Math.round(process.uptime()), timestamp: nowIso() }, requestId);
    }

    if (req.method === "GET" && pathname === "/api/stream") return serveEventStream(req, res, requestId);

    if (req.method === "POST" && pathname === "/api/session") return ok(res, createSession(requestId), requestId, 201);

    if (req.method === "GET" && pathname === "/api/bootstrap") {
      const snapshot = store.getSnapshot();
      return ok(res, {
        firewall: snapshot.firewall,
        posture: postureFromFirewall(snapshot.firewall),
        events: snapshot.events.slice(0, 12),
        packets: snapshot.packets.slice(0, 50),
        aggregate: snapshot.aggregate,
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt,
        capabilities: { realNetworkTraffic: false, realFirewallChanges: false, safeSimulation: true, eventStream: true }
      }, requestId);
    }

    if (req.method === "GET" && pathname === "/api/security/posture") return ok(res, postureFromFirewall(store.getFirewall()), requestId);
    if (req.method === "GET" && pathname === "/api/firewall") return ok(res, store.getFirewall(), requestId);

    if (req.method === "PUT" && pathname === "/api/firewall") {
      const session = validateSession(req);
      if (!session) return fail(res, 401, "SESSION_REQUIRED", "Create or refresh a demo session before changing lab state.", requestId);
      const body = await readJson(req);
      const parsed = validateToggle(body);
      if (parsed.error) return fail(res, 400, "INVALID_BODY", parsed.error, requestId);
      const firewall = store.setFirewallEnabled(parsed.value);
      const payload = { firewall, posture: postureFromFirewall(firewall) };
      store.addEvent({ type: firewall.enabled ? "success" : "danger", label: firewall.enabled ? "ENABLE" : "DISABLE", payload: "simulated firewall state changed", reason: `session ${session.id.slice(0, 8)}` });
      broadcast("firewall.updated", payload);
      return ok(res, payload, requestId);
    }

    const ruleMatch = pathname.match(/^\/api\/firewall\/rules\/([a-z]+)$/);
    if (req.method === "PUT" && ruleMatch) {
      const session = validateSession(req);
      if (!session) return fail(res, 401, "SESSION_REQUIRED", "Create or refresh a demo session before changing lab state.", requestId);
      const body = await readJson(req);
      const parsed = validateToggle(body);
      if (parsed.error) return fail(res, 400, "INVALID_BODY", parsed.error, requestId);
      const rule = ruleMatch[1];
      const firewall = store.setRule(rule, parsed.value);
      if (!firewall) return fail(res, 404, "RULE_NOT_FOUND", "Unknown firewall rule.", requestId);
      const payload = { firewall, posture: postureFromFirewall(firewall), rule };
      store.addEvent({ type: parsed.value ? "success" : "warning", label: parsed.value ? "RULE ON" : "RULE OFF", payload: `${rule} policy updated`, reason: "simulated control plane" });
      broadcast("firewall.rule.updated", payload);
      return ok(res, payload, requestId);
    }

    if (req.method === "POST" && pathname === "/api/simulations") {
      const session = validateSession(req);
      if (!session) return fail(res, 401, "SESSION_REQUIRED", "Create or refresh a demo session before running tests.", requestId);
      const body = await readJson(req);
      const parsed = validateSimulation(body);
      if (parsed.error) return fail(res, 400, "INVALID_SIMULATION", parsed.error, requestId);
      await new Promise((resolve) => setTimeout(resolve, config.simulationDelayMs));
      const result = runSimulation(parsed.value, store.getFirewall());
      const events = result.events.map((event) => store.addEvent(event));
      const packets = result.packets.map((packet) => store.addPacket(packet));
      const aggregate = store.recordSimulation(result);
      const payload = { ...result, events, packets, aggregate };
      broadcast("simulation.completed", payload);
      return ok(res, payload, requestId, 201);
    }

    if (req.method === "GET" && pathname === "/api/events") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
      return ok(res, store.getEvents(limit), requestId);
    }

    if (req.method === "DELETE" && pathname === "/api/events") {
      const session = validateSession(req);
      if (!session) return fail(res, 401, "SESSION_REQUIRED", "Create or refresh a demo session before clearing events.", requestId);
      store.clearEvents();
      broadcast("events.cleared", { by: session.id.slice(0, 8) });
      return ok(res, { cleared: true }, requestId);
    }

    if (req.method === "GET" && pathname === "/api/packets") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      const query = String(url.searchParams.get("q") || "").slice(0, 100);
      return ok(res, store.getPackets(limit, query), requestId);
    }

    if (req.method === "POST" && pathname === "/api/packets/inject") {
      const session = validateSession(req);
      if (!session) return fail(res, 401, "SESSION_REQUIRED", "Create or refresh a demo session before generating sample data.", requestId);
      const packet = store.addPacket({ source: `203.0.113.${Math.floor(Math.random() * 200) + 20}`, destination: "10.0.0.5", protocol: "UDP", length: 517, info: "SPOOFED AUTH / invalid MAC", decision: "BLOCK" });
      const event = store.addEvent({ type: "danger", label: "BLOCK", payload: "external source invalid authentication tag", reason: "identity verification" });
      const payload = { packet, event, note: "Sample data only; no packet was sent." };
      broadcast("packet.injected", payload);
      return ok(res, payload, requestId, 201);
    }

    if (pathname.startsWith("/api/")) return fail(res, 404, "NOT_FOUND", "API route not found.", requestId);
    return serveStatic(req, res, pathname, requestId);
  } catch (error) {
    console.error(`[${requestId}]`, error);
    if (!res.headersSent) fail(res, error.status || 500, error.status === 413 ? "PAYLOAD_TOO_LARGE" : error.status === 400 ? "INVALID_JSON" : "INTERNAL_ERROR", error.status ? error.message : "Unexpected server error.", requestId);
    else res.destroy();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`${nowIso()} ${req.method} ${pathname} ${res.statusCode || 200} ${durationMs.toFixed(1)}ms req=${requestId}`);
  }
});

const heartbeat = setInterval(() => {
  broadcast("heartbeat", { uptimeSeconds: Math.round(process.uptime()), clients: sseClients.size, posture: postureFromFirewall(store.getFirewall()) });
}, 10_000);
heartbeat.unref();

server.listen(config.port, "0.0.0.0", () => console.log(`SecurePlay running on http://0.0.0.0:${config.port}`));

function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  clearInterval(heartbeat);
  for (const client of sseClients) client.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
