export function analyzeSnapshot(snapshot) {
  const packets = Array.isArray(snapshot.packets) ? snapshot.packets : [];
  const decisions = { allow: 0, drop: 0, block: 0 };
  const sources = new Map();

  for (const packet of packets) {
    const decision = String(packet.decision || "").toLowerCase();
    if (decision in decisions) decisions[decision] += 1;
    const source = String(packet.source || "unknown");
    const current = sources.get(source) || { source, total: 0, blocked: 0 };
    current.total += 1;
    if (decision === "block" || decision === "drop") current.blocked += 1;
    sources.set(source, current);
  }

  const total = packets.length;
  const blocked = decisions.block + decisions.drop;
  const blockRate = total ? Math.round((blocked / total) * 100) : 0;
  const topSources = [...sources.values()]
    .sort((a, b) => b.blocked - a.blocked || b.total - a.total)
    .slice(0, 4);
  const riskLevel = blockRate >= 35 ? "elevated" : blockRate >= 15 ? "guarded" : "normal";

  return {
    generatedAt: new Date().toISOString(),
    totalPackets: total,
    decisions,
    blockRate,
    riskLevel,
    topSources,
    recommendation: riskLevel === "elevated"
      ? "Review rate limiting and inspect repeated sources before continuing the test."
      : riskLevel === "guarded"
        ? "Controls are responding; continue monitoring suspicious traffic patterns."
        : "Traffic is stable. Keep validation and default-deny controls enabled."
  };
}
