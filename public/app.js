(() => {
  "use strict";

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const API_BASE = "";
  const SESSION_KEY = "secureplay-demo-token";

  const state = {
    token: sessionStorage.getItem(SESSION_KEY) || "",
    socket: null,
    backendOnline: false,
    filteringTimer: null
  };

  const toast = $("#toast");
  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setBackendStatus(online, label) {
    state.backendOnline = online;
    const status = $("#monitoring-status");
    if (!status) return;
    status.classList.toggle("offline", !online);
    status.innerHTML = `<span></span> ${escapeHtml(label || (online ? "Backend connected" : "Backend unavailable"))}`;
  }

  async function api(path, options = {}) {
    const { auth = false, ...fetchOptions } = options;
    if (auth && !state.token) await ensureSession();

    const headers = new Headers(fetchOptions.headers || {});
    if (fetchOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (auth && state.token) headers.set("X-Demo-Token", state.token);

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers });
    } catch (error) {
      setBackendStatus(false, "Backend offline");
      throw new Error("The backend could not be reached.");
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && auth) {
      state.token = "";
      sessionStorage.removeItem(SESSION_KEY);
      await ensureSession();
      return api(path, options);
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload?.error?.message || `Request failed (${response.status})`);
    }
    setBackendStatus(true, "Backend connected");
    return payload.data;
  }

  async function ensureSession() {
    const session = await api("/api/session", { method: "POST" });
    state.token = session.token;
    sessionStorage.setItem(SESSION_KEY, state.token);
    return session;
  }

  // Scroll reveal
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        $$(".reveal", entry.target).forEach((el) => el.classList.add("visible"));
        entry.target.classList.add("in-view");
      });
    },
    { threshold: 0.12 }
  );
  $$('[data-observe]').forEach((section) => revealObserver.observe(section));

  // Active sidebar section
  const sections = $$('section[id]');
  const navLinks = $$('.nav-link');
  const navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => link.classList.toggle("active", link.dataset.section === entry.target.id));
      });
    },
    { rootMargin: "-30% 0px -60% 0px", threshold: 0.01 }
  );
  sections.forEach((section) => navObserver.observe(section));

  // Counter animation
  const counters = $$('.count');
  const countObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.target.dataset.done) return;
        entry.target.dataset.done = "1";
        const target = Number(entry.target.dataset.target);
        const duration = 1200;
        const startTime = performance.now();
        function tick(now) {
          const progress = Math.min((now - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const value = Math.round(target * eased);
          entry.target.textContent = target === 99 ? `${value}%` : value.toLocaleString();
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    },
    { threshold: 0.7 }
  );
  counters.forEach((counter) => countObserver.observe(counter));

  // Theme
  const themeToggle = $("#theme-toggle");
  const themeIcon = $("#theme-icon");
  const storedTheme = localStorage.getItem("secureplay-theme");
  if (storedTheme === "light") {
    document.body.classList.add("light-theme");
    themeIcon.textContent = "â˜€";
  }
  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    const light = document.body.classList.contains("light-theme");
    themeIcon.textContent = light ? "â˜€" : "â˜¾";
    localStorage.setItem("secureplay-theme", light ? "light" : "dark");
    showToast(light ? "Light interface enabled" : "Dark interface enabled");
  });

  // Focus mode
  $("#presentation-mode").addEventListener("click", () => {
    document.body.classList.toggle("focus-mode");
    const enabled = document.body.classList.contains("focus-mode");
    $("#presentation-mode").textContent = enabled ? "Exit focus" : "Focus mode";
    showToast(enabled ? "Focus mode enabled" : "Focus mode disabled");
    setTimeout(resizeCanvas, 360);
  });

  // Mobile menu
  const sidebar = $("#sidebar");
  $("#menu-button").addEventListener("click", () => sidebar.classList.toggle("open"));
  navLinks.forEach((link) => link.addEventListener("click", () => sidebar.classList.remove("open")));
  document.addEventListener("click", (event) => {
    if (window.innerWidth > 820) return;
    if (!sidebar.contains(event.target) && !$("#menu-button").contains(event.target)) sidebar.classList.remove("open");
  });

  const firewallToggle = $("#firewall-toggle");
  const rules = $$(".rule");

  function renderFirewall(firewall, posture) {
    firewallToggle.classList.toggle("on", Boolean(firewall.enabled));
    firewallToggle.setAttribute("aria-pressed", String(Boolean(firewall.enabled)));
    rules.forEach((rule) => {
      const enabled = Boolean(firewall.rules[rule.dataset.rule]);
      rule.classList.toggle("enabled", enabled);
      $(".rule-toggle", rule).textContent = enabled ? "ON" : "OFF";
    });
    renderPosture(posture);
  }

  function renderPosture(posture) {
    $("#security-score").textContent = `${posture.score}%`;
    $("#security-meter-fill").style.width = `${posture.score}%`;
    $("#lab-status").textContent = posture.level === "protected" ? "Server protected" : posture.level === "reduced" ? "Protection reduced" : "Server exposed";
    $("#terminal-output").innerHTML = posture.level === "exposed"
      ? `<span style="color:var(--red)">STATUS</span> ${escapeHtml(posture.summary)}`
      : `<span>STATUS</span> ${escapeHtml(posture.summary)}`;
  }

  firewallToggle.addEventListener("click", async () => {
    const desired = !firewallToggle.classList.contains("on");
    firewallToggle.disabled = true;
    try {
      const response = await api("/api/firewall", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({ enabled: desired })
      });
      renderFirewall(response.firewall, response.posture);
      showToast(desired ? "Firewall enabled" : "Warning: firewall disabled");
    } catch (error) {
      showToast(error.message);
    } finally {
      firewallToggle.disabled = false;
    }
  });

  rules.forEach((rule) => {
    const button = $(".rule-toggle", rule);
    button.addEventListener("click", async () => {
      const desired = !rule.classList.contains("enabled");
      button.disabled = true;
      try {
        const response = await api(`/api/firewall/rules/${encodeURIComponent(rule.dataset.rule)}`, {
          method: "PUT",
          auth: true,
          body: JSON.stringify({ enabled: desired })
        });
        renderFirewall(response.firewall, response.posture);
        showToast(`${rule.dataset.rule} rule ${desired ? "enabled" : "disabled"}`);
      } catch (error) {
        showToast(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  // Copy commands
  $("#copy-command").addEventListener("click", async () => {
    const command = $("#firewall-code").innerText;
    try {
      await navigator.clipboard.writeText(command);
      showToast("Firewall commands copied");
    } catch {
      showToast("Copy unavailable in this browser");
    }
  });

  // Test controls
  const controls = {
    latency: { range: $("#latency-range"), output: $("#latency-value") },
    loss: { range: $("#loss-range"), output: $("#loss-value") },
    jitter: { range: $("#jitter-range"), output: $("#jitter-value") }
  };
  Object.values(controls).forEach(({ range, output }) => range.addEventListener("input", () => (output.value = range.value)));
  const conditionButtons = $$(".condition-button");
  conditionButtons.forEach((button) => button.addEventListener("click", () => button.classList.toggle("active")));

  function chartPaths(points) {
    const line = points.map(({ x, y }, index) => `${index ? "L" : "M"}${x},${y}`).join(" ");
    const last = points[points.length - 1] || { x: 640, y: 125 };
    return { line, area: `${line} L640,250 L0,250 Z`, last };
  }

  function formatEventTime(createdAt) {
    const date = new Date(createdAt || Date.now());
    return `${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}.${String(date.getMilliseconds()).padStart(3, "0")}`;
  }

  function eventNode(event) {
    const row = document.createElement("div");
    row.className = `event-row ${["success", "warning", "danger"].includes(event.type) ? event.type : "success"}`;
    row.dataset.eventId = event.id || "";
    row.innerHTML = `<time>${escapeHtml(formatEventTime(event.createdAt))}</time><span>${escapeHtml(event.label)}</span><code>${escapeHtml(event.payload)}</code><em>${escapeHtml(event.reason)}</em>`;
    return row;
  }

  function renderEvents(events, { replace = true } = {}) {
    const list = $("#event-list");
    if (replace) list.innerHTML = "";
    const known = new Set($$("[data-event-id]", list).map((node) => node.dataset.eventId).filter(Boolean));
    events.slice().reverse().forEach((event) => {
      if (event.id && known.has(event.id)) return;
      list.prepend(eventNode(event));
    });
    while (list.children.length > 12) list.removeChild(list.lastElementChild);
  }

  function decisionClass(decision) {
    const value = String(decision || "").toLowerCase();
    if (value === "allow") return "allow";
    if (value === "drop") return "drop";
    return "block";
  }

  function packetNode(packet) {
    const row = document.createElement("tr");
    row.dataset.info = String(packet.info || "").toLowerCase();
    row.dataset.packetId = String(packet.id || "");
    row.innerHTML = `<td>${escapeHtml(packet.id)}</td><td>${escapeHtml(packet.source)}</td><td>${escapeHtml(packet.destination)}</td><td><span class="protocol">${escapeHtml(packet.protocol)}</span></td><td>${escapeHtml(packet.length)}</td><td>${escapeHtml(packet.info)}</td><td><span class="decision ${decisionClass(packet.decision)}">${escapeHtml(packet.decision)}</span></td>`;
    return row;
  }

  function renderPackets(packets, { replace = true } = {}) {
    const body = $("#packet-table-body");
    if (replace) body.innerHTML = "";
    const known = new Set($$("[data-packet-id]", body).map((node) => node.dataset.packetId).filter(Boolean));
    packets.slice().reverse().forEach((packet) => {
      if (packet.id && known.has(String(packet.id))) return;
      body.prepend(packetNode(packet));
    });
    while (body.children.length > 50) body.removeChild(body.lastElementChild);
  }

  function renderMetrics(data) {
    $("#packets-sent").textContent = Number(data.sent ?? data.packetsSent ?? 0).toLocaleString();
    $("#validated-packets").textContent = Number(data.validated ?? 0).toLocaleString();
    $("#rejected-packets").textContent = Number(data.rejected ?? 0).toLocaleString();
    $("#average-rtt").textContent = `${Number(data.avgRtt ?? data.averageRtt ?? 0)} ms`;
    const accepted = data.acceptanceRate ?? ((Number(data.validated || 0) / Math.max(1, Number(data.sent || data.packetsSent || 1))) * 100);
    const validatedSmall = $("#validated-packets").nextElementSibling;
    if (validatedSmall) validatedSmall.textContent = `${Number(accepted).toFixed(1)}% accepted`;
  }

  $("#run-test").addEventListener("click", async () => {
    const button = $("#run-test");
    const payload = {
      latency: Number(controls.latency.range.value),
      loss: Number(controls.loss.range.value),
      jitter: Number(controls.jitter.range.value),
      conditions: conditionButtons.filter((item) => item.classList.contains("active")).map((item) => item.dataset.condition)
    };

    button.disabled = true;
    button.classList.add("running");
    button.querySelector("span:last-child").textContent = "Backend testingâ€¦";
    try {
      const result = await api("/api/simulations", {
        method: "POST",
        auth: true,
        body: JSON.stringify(payload)
      });
      const paths = chartPaths(result.chart);
      $("#line-path").setAttribute("d", paths.line);
      $("#area-path").setAttribute("d", paths.area);
      $("#chart-dot").setAttribute("cx", paths.last.x);
      $("#chart-dot").setAttribute("cy", paths.last.y);
      renderMetrics(result);
      renderEvents(result.events, { replace: false });
      renderPackets(result.packets, { replace: false });
      showToast(`Test complete: ${result.rejected.toLocaleString()} packets rejected`);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.classList.remove("running");
      button.querySelector("span:last-child").textContent = "Run security test";
    }
  });

  $("#clear-events").addEventListener("click", async () => {
    const button = $("#clear-events");
    button.disabled = true;
    try {
      await api("/api/events", { method: "DELETE", auth: true });
      $("#event-list").innerHTML = "";
      showToast("Event log cleared");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("#packet-filter").addEventListener("input", (event) => {
    clearTimeout(state.filteringTimer);
    state.filteringTimer = setTimeout(async () => {
      try {
        const packets = await api(`/api/packets?limit=50&q=${encodeURIComponent(event.target.value)}`);
        renderPackets(packets);
      } catch (error) {
        showToast(error.message);
      }
    }, 250);
  });

  $("#inject-packet").addEventListener("click", async () => {
    const button = $("#inject-packet");
    button.disabled = true;
    try {
      const result = await api("/api/packets/inject", { method: "POST", auth: true });
      renderPackets([result.packet], { replace: false });
      renderEvents([result.event], { replace: false });
      showToast("Sample attack generated and blocked by backend");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderAnalytics(analysis) {
    $("#analysis-risk-level").textContent = analysis.riskLevel || "normal";
    $("#analysis-total").textContent = Number(analysis.totalPackets || 0).toLocaleString();
    $("#analysis-rejected").textContent = Number((analysis.decisions?.drop || 0) + (analysis.decisions?.block || 0)).toLocaleString();
    $("#analysis-rate").textContent = `${Number(analysis.blockRate || 0)}%`;
    $("#analysis-recommendation").textContent = analysis.recommendation || "No recommendation available.";
    const watchlist = $("#analysis-watchlist");
    watchlist.innerHTML = "";
    (analysis.topSources || []).forEach((item) => {
      const row = document.createElement("div");
      row.innerHTML = `<span>${escapeHtml(item.source)}</span><span>${Number(item.blocked)} rejected / ${Number(item.total)} total</span>`;
      watchlist.appendChild(row);
    });
    if (!watchlist.children.length) watchlist.innerHTML = "<div><span>No suspicious sources</span><span>Stable</span></div>";
  }

  async function loadAnalytics() {
    try {
      renderAnalytics(await api("/api/analytics"));
    } catch (error) {
      $("#analysis-recommendation").textContent = error.message;
    }
  }

  $$(".analysis-tab").forEach((tab) => tab.addEventListener("click", async () => {
    const view = tab.dataset.analysisTab;
    $$(".analysis-tab").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    $$('[data-analysis-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.analysisPanel !== view;
    });
    if (view === "intelligence") await loadAnalytics();
  }));

  $("#download-report").addEventListener("click", async () => {
    const button = $("#download-report");
    button.disabled = true;
    try {
      const payload = await api("/api/reports/security");
      downloadText(`secureplay-report-${new Date().toISOString().slice(0, 10)}.md`, payload.report, "text/markdown;charset=utf-8");
      showToast("Security report downloaded");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("#export-packets").addEventListener("click", async () => {
    const button = $("#export-packets");
    button.disabled = true;
    try {
      const packets = await api("/api/packets?limit=100");
      const columns = ["id", "createdAt", "source", "destination", "protocol", "length", "info", "decision"];
      const csv = [columns.join(","), ...packets.map((packet) => columns.map((key) => `"${String(packet[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
      downloadText(`secureplay-packets-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
      showToast("Packet CSV downloaded");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  function connectEventStream() {
    const stream = new EventSource("/api/stream");
    state.socket = stream;

    stream.addEventListener("open", () => setBackendStatus(true, "Live backend connected"));
    const handle = (message) => {
      let data;
      try { data = JSON.parse(message.data); } catch { return; }
      if (data.event === "heartbeat") {
        setBackendStatus(true, `Live monitoring Â· ${data.payload.clients} viewer${data.payload.clients === 1 ? "" : "s"}`);
        renderPosture(data.payload.posture);
      }
      if (data.event === "firewall.updated" || data.event === "firewall.rule.updated") {
        renderFirewall(data.payload.firewall, data.payload.posture);
      }
      if (data.event === "events.cleared") $("#event-list").innerHTML = "";
    };
    ["connected", "heartbeat", "firewall.updated", "firewall.rule.updated", "events.cleared", "simulation.completed", "packet.injected"].forEach((eventName) => stream.addEventListener(eventName, handle));
    stream.addEventListener("error", () => setBackendStatus(false, "Reconnecting backendâ€¦"));
  }

  async function bootstrap() {
    setBackendStatus(false, "Connecting backendâ€¦");
    try {
      const data = await api("/api/bootstrap");
      renderFirewall(data.firewall, data.posture);
      renderEvents(data.events);
      renderPackets(data.packets);
      renderMetrics(data.aggregate);
      await ensureSession();
      connectEventStream();
    } catch (error) {
      setBackendStatus(false, "Backend unavailable");
      showToast(`${error.message} Start the Node server to enable controls.`);
    }
  }

  // Footer year
  $("#footer-year").textContent = new Date().getFullYear();

  // Motion canvas â€” subtle connected particles
  const canvas = $("#motion-canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  let particles = [];
  let animationFrame;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.max(24, Math.min(75, Math.floor(innerWidth / 22)));
    particles = Array.from({ length: count }, () => ({
      x: randomBetween(0, innerWidth),
      y: randomBetween(0, innerHeight),
      vx: randomBetween(-0.15, 0.15),
      vy: randomBetween(-0.15, 0.15),
      r: randomBetween(0.6, 1.7)
    }));
  }

  function drawParticles() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const light = document.body.classList.contains("light-theme");
    ctx.fillStyle = light ? "rgba(0,141,182,.34)" : "rgba(56,216,255,.36)";
    ctx.strokeStyle = light ? "rgba(0,141,182,.075)" : "rgba(56,216,255,.07)";
    particles.forEach((p, index) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > innerWidth) p.vx *= -1;
      if (p.y < 0 || p.y > innerHeight) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      for (let j = index + 1; j < particles.length; j += 1) {
        const q = particles[j];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        if (dx * dx + dy * dy < 13500) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    });
    animationFrame = requestAnimationFrame(drawParticles);
  }

  resizeCanvas();
  if (!reducedMotion) drawParticles();
  window.addEventListener(
    "resize",
    () => {
      cancelAnimationFrame(animationFrame);
      resizeCanvas();
      if (!reducedMotion) drawParticles();
    },
    { passive: true }
  );

  bootstrap();
})();
