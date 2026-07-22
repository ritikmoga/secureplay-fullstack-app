export function buildSecurityReport(snapshot, posture, analysis) {
  const generatedAt = new Date().toISOString();
  const rules = Object.entries(snapshot.firewall?.rules || {})
    .map(([name, enabled]) => `- ${name}: ${enabled ? "enabled" : "disabled"}`)
    .join("\n");
  const sources = analysis.topSources.length
    ? analysis.topSources.map((item) => `- ${item.source}: ${item.total} observed, ${item.blocked} rejected`).join("\n")
    : "- No packet data available";

  return `# SecurePlay security snapshot\n\nGenerated: ${generatedAt}\n\n## Posture\n- Level: ${posture.level}\n- Score: ${posture.score}%\n- Summary: ${posture.summary}\n\n## Firewall controls\n${rules}\n\n## Traffic intelligence\n- Packets observed: ${analysis.totalPackets}\n- Allowed: ${analysis.decisions.allow}\n- Dropped: ${analysis.decisions.drop}\n- Blocked: ${analysis.decisions.block}\n- Rejection rate: ${analysis.blockRate}%\n- Risk level: ${analysis.riskLevel}\n\n## Watchlist\n${sources}\n\n## Recommendation\n${analysis.recommendation}\n\nThis report contains simulated lab data only. No live network traffic or operating-system firewall changes were performed.\n`;
}
