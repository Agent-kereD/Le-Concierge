# Le Concierge

A web app for building residents to interact with the building concierge:
announce visitors (photo + live audio), approve or deny entry, and receive
package drop-off notifications.

## Components

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `js/` | Resident app (single page, no build step) |
| `server/server.js` | Simulated concierge service (Node, no dependencies) |
| `server/admin.html` | Concierge console UI (send visitors, log packages) |
| `start.sh` | Starts the service (loopback only) |
| `js/config.js` | Concierge API settings — one place to wire in the real building API |

## Features

**Resident setup**
- Choose to remain **anonymous** (known to the concierge only by a generated ID)
  or supply personal details (**name + flat required**; email, phone and
  WhatsApp optional — WhatsApp requires a phone number).

**Visitor interaction**
- The concierge sends the resident a **photo of the visitor** together with a
  **live audio feed** from the intercom; the resident approves or denies entry.
  All decisions are kept in a visitor log.

**Packages**
- Drop-offs logged by the concierge appear on the resident's Packages tab.

**Concierge console** (`/admin`)
- Announce visitors with an optional real photo, log package drop-offs, and
  watch resident decisions arrive in real time (SSE).

## Run

```bash
node concierge-app/server/server.js   # or port 8123 with: PORT=8123 node …
```

Then open:

- Resident app: http://127.0.0.1:8124/
- Concierge console: http://127.0.0.1:8124/admin

Run in "mock" mode (no server) by setting `MODE: "mock"` in `js/config.js`.

## Wiring in the real concierge API

All integration points live in `js/config.js` (`BASE_URL`, `AUTH_TOKEN`,
endpoint paths, `AUDIO_TRANSPORT`) and the adapter in `js/api.js`. The app is
currently configured for the local simulator: REST under `/api`, server-sent
events at `/api/events`, and a chunked HTTP WAV stream for live audio. When the
building supplies the real API, swap the adapter internals — the UI needs no
changes.
