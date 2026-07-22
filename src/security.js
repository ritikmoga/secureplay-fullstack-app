import crypto from "node:crypto";
import { config } from "./config.js";

const sessions = new Map();

const pruneSessions = () => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
};

export const createDemoSession = (requestId) => {
  pruneSessions();
  const token = crypto.randomBytes(24).toString("base64url");
  const session = {
    id: crypto.randomUUID(),
    token,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.sessionTtlMs,
    requestId
  };
  sessions.set(token, session);
  return { id: session.id, token: session.token, expiresAt: new Date(session.expiresAt).toISOString() };
};

export const requireDemoSession = (req, res, next) => {
  pruneSessions();
  const token = req.get("x-demo-token");
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    return res.status(401).json({
      ok: false,
      error: { code: "SESSION_REQUIRED", message: "Create or refresh a demo session before changing lab state." },
      requestId: req.id
    });
  }
  req.demoSession = session;
  next();
};

export const postureFromFirewall = (firewall) => {
  const enabledCount = Object.values(firewall.rules).filter(Boolean).length;
  const score = firewall.enabled ? Math.min(99, Math.max(38, 56 + enabledCount * 10)) : 18;
  return {
    score,
    level: score >= 90 ? "protected" : score >= 60 ? "reduced" : "exposed",
    summary: firewall.enabled
      ? "Active · default deny incoming · UDP 7777 explicitly allowed"
      : "Inactive · inbound filtering disabled",
    enabledControls: enabledCount + (firewall.enabled ? 1 : 0),
    totalControls: Object.keys(firewall.rules).length + 1
  };
};
