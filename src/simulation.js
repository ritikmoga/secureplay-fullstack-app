import crypto, { randomInt } from "node:crypto";

const randomBetween = (min, max) => Math.random() * (max - min) + min;

const makeChart = (latency, jitter, loss) => {
  const values = Array.from({ length: 11 }, () => {
    const baseline = 205 - Math.min(155, latency * 0.55);
    const noise = randomBetween(-jitter * 0.55, jitter * 0.55) - loss * 0.55;
    return Math.round(Math.max(25, Math.min(220, baseline + noise)));
  });
  return values.map((y, index) => ({ x: index * 64, y }));
};

const sourceForCondition = (condition) => {
  if (condition === "flood") return `198.51.100.${randomInt(20, 220)}`;
  if (condition === "malformed") return `203.0.113.${randomInt(20, 220)}`;
  return `10.0.0.${randomInt(20, 29)}`;
};

export const runSimulation = ({ latency, loss, jitter, conditions }, firewall) => {
  let sent = 1240 + randomInt(90, 421);
  if (conditions.includes("flood")) sent += randomInt(1200, 3201);

  const baseReject = Math.round(sent * (loss / 100));
  const threatReject =
    conditions.length * randomInt(9, 29) +
    (conditions.includes("flood") ? (firewall.rules.rate ? 280 : 75) : 0) +
    (!firewall.enabled ? -Math.round(baseReject * 0.35) : 0);

  const rejected = Math.max(0, Math.min(sent, baseReject + threatReject));
  const validated = sent - rejected;
  const avgRtt = Math.round(latency * 1.12 + jitter * 0.7 + randomBetween(3, 14));
  const acceptanceRate = sent ? Number(((validated / sent) * 100).toFixed(1)) : 0;

  const events = [
    { type: "success", label: "ACCEPT", payload: `player_a move seq=${randomInt(2000, 9001)}`, reason: `${avgRtt} ms RTT` }
  ];
  const packets = [
    { source: "10.0.0.21", destination: "10.0.0.5", protocol: "UDP", length: randomInt(110, 188), info: `MOVE seq=${randomInt(2000, 9001)} validated`, decision: "ALLOW" }
  ];

  for (const condition of conditions) {
    if (condition === "duplicate") {
      events.push({ type: "warning", label: "DROP", payload: "duplicate sequence detected", reason: "anti-replay window" });
      packets.push({ source: sourceForCondition(condition), destination: "10.0.0.5", protocol: "UDP", length: 144, info: "Duplicate sequence inside replay window", decision: "DROP" });
    }
    if (condition === "reorder") {
      events.push({ type: "warning", label: "DROP", payload: "stale sequence arrived late", reason: "sequence validation" });
      packets.push({ source: sourceForCondition(condition), destination: "10.0.0.5", protocol: "UDP", length: 136, info: "Out-of-order stale sequence", decision: "DROP" });
    }
    if (condition === "malformed") {
      events.push({ type: "danger", label: "BLOCK", payload: "payload type mismatch / oversize", reason: "schema invalid" });
      packets.push({ source: sourceForCondition(condition), destination: "10.0.0.5", protocol: "UDP", length: randomInt(520, 850), info: "Malformed payload / invalid schema", decision: firewall.enabled ? "BLOCK" : "OBSERVE" });
    }
    if (condition === "flood") {
      events.push({ type: "danger", label: "BLOCK", payload: `source burst ${randomInt(500, 1101)}/s`, reason: firewall.rules.rate ? "rate limiter" : "rate limiter disabled" });
      packets.push({ source: sourceForCondition(condition), destination: "10.0.0.5", protocol: "UDP", length: 96, info: "High-rate source burst", decision: firewall.enabled && firewall.rules.rate ? "BLOCK" : "OBSERVE" });
    }
  }

  if (!conditions.length) {
    events.push({ type: "success", label: "PASS", payload: "baseline network profile completed", reason: "no critical anomaly" });
  }

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    input: { latency, loss, jitter, conditions },
    sent,
    validated,
    rejected,
    avgRtt,
    acceptanceRate,
    chart: makeChart(latency, jitter, loss),
    events,
    packets,
    note: "This is a safe simulation. No network traffic or operating-system firewall rules were modified."
  };
};
