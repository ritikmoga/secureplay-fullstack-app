import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

const nowIso = () => new Date().toISOString();

const defaultPackets = [
  { id: 1845, source: "10.0.0.21", destination: "10.0.0.5", protocol: "UDP", length: 142, info: "MOVE seq=4821 position delta", decision: "ALLOW", createdAt: nowIso() },
  { id: 1844, source: "10.0.0.22", destination: "10.0.0.5", protocol: "UDP", length: 128, info: "ACTION seq=3910 jump", decision: "ALLOW", createdAt: nowIso() },
  { id: 1843, source: "10.0.0.21", destination: "10.0.0.5", protocol: "UDP", length: 166, info: "MOVE duplicate seq=4819", decision: "DROP", createdAt: nowIso() },
  { id: 1842, source: "198.51.100.77", destination: "10.0.0.5", protocol: "UDP", length: 614, info: "Oversize payload / invalid schema", decision: "BLOCK", createdAt: nowIso() }
];

const defaultState = () => ({
  revision: 1,
  updatedAt: nowIso(),
  firewall: {
    enabled: true,
    rules: {
      game: true,
      ssh: true,
      default: true,
      rate: true
    }
  },
  events: [
    { id: randomUUID(), type: "success", label: "ACCEPT", payload: "player_a move seq=4821", reason: "31 ms RTT", createdAt: nowIso() },
    { id: randomUUID(), type: "warning", label: "DROP", payload: "duplicate sequence detected", reason: "anti-replay window", createdAt: nowIso() },
    { id: randomUUID(), type: "danger", label: "BLOCK", payload: "payload type mismatch / oversize", reason: "schema invalid", createdAt: nowIso() }
  ],
  packets: defaultPackets,
  aggregate: {
    simulations: 0,
    packetsSent: 1240,
    validated: 1215,
    rejected: 25,
    averageRtt: 31
  }
});

class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = defaultState();
    this.writeQueue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.persistSync();
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.state = {
        ...defaultState(),
        ...parsed,
        firewall: { ...defaultState().firewall, ...(parsed.firewall || {}) },
        aggregate: { ...defaultState().aggregate, ...(parsed.aggregate || {}) }
      };
    } catch (error) {
      console.error("State file could not be loaded; using defaults:", error.message);
      this.state = defaultState();
      this.persistSync();
    }
  }

  persistSync() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  schedulePersist() {
    this.state.revision += 1;
    this.state.updatedAt = nowIso();
    const snapshot = JSON.stringify(this.state, null, 2);
    const tempPath = `${this.filePath}.tmp`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.promises.writeFile(tempPath, snapshot);
        await fs.promises.rename(tempPath, this.filePath);
      })
      .catch((error) => console.error("State persistence failed:", error.message));
    return this.writeQueue;
  }

  getSnapshot() {
    return structuredClone(this.state);
  }

  getFirewall() {
    return structuredClone(this.state.firewall);
  }

  setFirewallEnabled(enabled) {
    this.state.firewall.enabled = Boolean(enabled);
    this.schedulePersist();
    return this.getFirewall();
  }

  setRule(rule, enabled) {
    if (!(rule in this.state.firewall.rules)) return null;
    this.state.firewall.rules[rule] = Boolean(enabled);
    this.schedulePersist();
    return this.getFirewall();
  }

  addEvent(event) {
    const record = { id: randomUUID(), createdAt: nowIso(), ...event };
    this.state.events.unshift(record);
    this.state.events = this.state.events.slice(0, config.maxEvents);
    this.schedulePersist();
    return structuredClone(record);
  }

  clearEvents() {
    this.state.events = [];
    this.schedulePersist();
  }

  getEvents(limit = 20) {
    return structuredClone(this.state.events.slice(0, limit));
  }

  addPacket(packet) {
    const highest = this.state.packets.reduce((max, item) => Math.max(max, Number(item.id) || 0), 1845);
    const record = {
      id: highest + Math.floor(Math.random() * 35) + 1,
      createdAt: nowIso(),
      ...packet
    };
    this.state.packets.unshift(record);
    this.state.packets = this.state.packets.slice(0, config.maxPackets);
    this.schedulePersist();
    return structuredClone(record);
  }

  getPackets(limit = 50, query = "") {
    const normalized = String(query).trim().toLowerCase().replace("udp.port == 7777", "").trim();
    const rows = normalized
      ? this.state.packets.filter((packet) => JSON.stringify(packet).toLowerCase().includes(normalized))
      : this.state.packets;
    return structuredClone(rows.slice(0, limit));
  }

  recordSimulation(result) {
    this.state.aggregate.simulations += 1;
    this.state.aggregate.packetsSent += result.sent;
    this.state.aggregate.validated += result.validated;
    this.state.aggregate.rejected += result.rejected;
    this.state.aggregate.averageRtt = Math.round(
      (this.state.aggregate.averageRtt * 3 + result.avgRtt) / 4
    );
    this.schedulePersist();
    return structuredClone(this.state.aggregate);
  }
}

export const store = new StateStore(config.dataFile);
