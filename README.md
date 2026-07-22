# SecurePlay Network Lab — Full Stack

A production-structured full-stack version of the SecurePlay case-study dashboard. It combines the accepted animated frontend with a safe backend control plane for firewall state, UDP-condition simulations, validation events, packet-table data, audit history, persistent JSON state, and live Server-Sent Events updates.

> Safety note: the backend simulates packet and firewall activity for coursework and demos. It never sends malicious traffic, captures real packets, or modifies operating-system firewall rules.

## Main capabilities

- Express REST API with schema validation
- Short-lived demo sessions for state-changing requests
- Rate limiting, security headers, body limits, CORS controls, and request IDs
- Simulated firewall and individual rule controls
- Safe latency/loss/jitter/anomaly simulation engine
- Persistent events, packet records, and aggregate metrics
- Server-Sent Events updates for state changes and simulation results
- Static delivery of the animated frontend
- Dockerfile and Render deployment blueprint
- Health-check endpoint at `/api/health`

## Run locally

No package installation is required because the backend uses only Node.js built-in modules.

```bash
npm start
```

Open `http://localhost:8080`.

## Development mode

```bash
npm run dev
```

## Environment variables

Copy `.env.example` to `.env` when needed. The app runs without secrets using safe defaults.

- `PORT`: HTTP port, default `8080`
- `ALLOWED_ORIGINS`: comma-separated origins; empty means same-server/demo-friendly behavior
- `TRUST_PROXY`: set to `1` on Render or behind one proxy
- `DATA_FILE`: persistent JSON state path
- `SESSION_TTL_MINUTES`: demo session lifetime

## Important API routes

- `GET /api/health`
- `POST /api/session`
- `GET /api/bootstrap`
- `GET /api/security/posture`
- `GET|PUT /api/firewall`
- `PUT /api/firewall/rules/:rule`
- `POST /api/simulations`
- `GET|DELETE /api/events`
- `GET /api/packets`
- `POST /api/packets/inject`
- `GET /api/stream` (Server-Sent Events)

Mutating routes require the `X-Demo-Token` header returned by `POST /api/session`.

## Deploy on Render

1. Upload this folder to a GitHub repository.
2. In Render, create a Blueprint and select the repository. Render detects `render.yaml`.
3. After deployment, Render provides the public URL and uses `/api/health` for health checks.

The included `start_windows.bat` and `start_mac_linux.sh` launch the project locally.

The same package also works on platforms that can run a Node web service or Docker container.
