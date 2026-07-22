import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const config = Object.freeze({
  rootDir,
  publicDir: path.join(rootDir, "public"),
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || "development",
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  // Vercel functions have a read-only deployment filesystem; /tmp is their
  // supported writable location. Local and Render deployments retain the
  // project data file unless DATA_FILE is explicitly provided.
  dataFile: process.env.DATA_FILE
    ? path.resolve(rootDir, process.env.DATA_FILE)
    : process.env.VERCEL
      ? "/tmp/secureplay-state.json"
      : path.join(rootDir, "data", "state.json"),
  sessionTtlMs: Number(process.env.SESSION_TTL_MINUTES || 120) * 60_000,
  maxEvents: 100,
  maxPackets: 150,
  simulationDelayMs: 650
});
