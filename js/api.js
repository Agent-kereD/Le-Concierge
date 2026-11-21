// Concierge API adapter.
// Implements the same interface for both a local mock (demo/development)
// and the live building concierge API (details to be supplied).
import { API_CONFIG } from "./config.js";

const POLL_MS = 5000;

function endpoint(name, vars = {}) {
  let url = API_CONFIG.ENDPOINTS[name];
  for (const [k, v] of Object.entries(vars)) url = url.replaceAll(`{${k}}`, encodeURIComponent(v));
  return API_CONFIG.BASE_URL + url;
}

async function liveFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (API_CONFIG.AUTH_TOKEN) headers.Authorization = `Bearer ${API_CONFIG.AUTH_TOKEN}`;
  const res = await fetch(path, { headers, ...options });
  if (!res.ok) throw new Error(`Concierge API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Mock implementation: simulates the concierge with an in-memory store,
// a generated visitor photo, and a live Web Audio tone as "real-time audio".
// ---------------------------------------------------------------------------

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function mockPhoto(label) {
  const c = document.createElement("canvas");
  c.width = c.height = 320;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 320, 320);
  grad.addColorStop(0, "#2b3a67");
  grad.addColorStop(1, "#16213e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 320);
  ctx.fillStyle = "#4d8dff";
  ctx.beginPath();
  ctx.arc(160, 130, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8ecf4";
  ctx.beginPath();
  ctx.arc(160, 260, 80, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = "#e8ecf4";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, 160, 55);
  return c.toDataURL("image/png");
}

const mock = {
  resident: JSON.parse(localStorage.getItem("concierge.resident") || "null"),
  currentVisitor: null,
  packages: [],
  listeners: { visitor: [], packages: [] },

  registerResident(profile) {
    // profile: { anonymous, residentId?, name?, flat?, email?, phone?, whatsapp? }
    this.resident = { ...profile, registeredAt: new Date().toISOString() };
    localStorage.setItem("concierge.resident", JSON.stringify(this.resident));
    return Promise.resolve(this.resident);
  },

  getVisitorAlert() {
    return Promise.resolve(this.currentVisitor);
  },

  sendDecision(visitorId, approve) {
    const v = this.currentVisitor;
    if (!v || v.id !== visitorId) return Promise.reject(new Error("No active visitor"));
    v.status = approve ? "approved" : "denied";
    v.decidedAt = new Date().toISOString();
    this.currentVisitor = null;
    this.emit("visitor", null);
    return Promise.resolve(v);
  },

  getPackages() {
    return Promise.resolve(this.packages);
  },

  attachLiveAudio(audioEl, onStatus) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.frequency.value = 340;
    lfo.frequency.value = 0.8;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(dest);
    osc.start();
    lfo.start();
    audioEl.srcObject = dest.stream;
    audioEl.play().catch(() => {});
    onStatus("live (simulated concierge feed)");
    return () => {
      osc.stop();
      lfo.stop();
      ctx.close();
    };
  },

  // Simulate the concierge sending visitor alerts / package notifications.
  simulate() {
    const scenarios = [
      () => {
        const id = genId();
        this.currentVisitor = {
          id,
          name: "Delivery courier",
          photo: mockPhoto("VISITOR"),
          message: "Courier with a parcel for your flat — sending you a live photo and audio.",
          arrivedAt: new Date().toISOString(),
          status: "pending",
        };
        this.emit("visitor", this.currentVisitor);
      },
      () => {
        const id = genId();
        this.currentVisitor = {
          id,
          name: "Sarah (friend)",
          photo: mockPhoto("VISITOR"),
          message: "A visitor says she is here to see you. Approve entry?",
          arrivedAt: new Date().toISOString(),
          status: "pending",
        };
        this.emit("visitor", this.currentVisitor);
      },
      () => {
        this.packages.unshift({
          id: genId(),
          courier: ["DHL", "Amazon", "Royal Mail", "DPD"][Math.floor(Math.random() * 4)],
          note: "Package dropped off at the concierge desk.",
          droppedAt: new Date().toISOString(),
        });
        this.emit("packages", this.packages);
      },
    ];

    let n = 0;
    const tick = () => {
      scenarios[n % scenarios.length]();
      n++;
    };
    setTimeout(tick, 2500);
    setTimeout(tick, 12000);
    setInterval(tick, 20000);
  },

  on(event, cb) {
    this.listeners[event].push(cb);
  },

  emit(event, payload) {
    this.listeners[event].forEach((cb) => cb(payload));
  },
};

// ---------------------------------------------------------------------------
// Public adapter — same surface regardless of mock/live mode.
// ---------------------------------------------------------------------------

export const conciergeApi = {
  mode: API_CONFIG.MODE,

  isRegistered() {
    return Boolean(JSON.parse(localStorage.getItem("concierge.resident") || "null"));
  },

  async registerResident(profile) {
    if (API_CONFIG.MODE === "live") {
      const res = await liveFetch(endpoint("register"), {
        method: "POST",
        body: JSON.stringify(profile),
      });
      localStorage.setItem("concierge.residentId", res.residentId);
      localStorage.setItem("concierge.resident", JSON.stringify({ ...profile, ...res }));
      return res;
    }
    return mock.registerResident(profile);
  },

  startEventFeed(handlers) {
    if (API_CONFIG.MODE === "live") {
      // Server-Sent Events: "visitor" (new/updated alert), "cleared"
      // (resolved visitor), "packages" (drop-off list).
      const es = new EventSource(endpoint("events"));
      es.addEventListener("visitor", (e) => handlers.onVisitor(JSON.parse(e.data)));
      es.addEventListener("cleared", (e) => {
        const v = JSON.parse(e.data);
        handlers.onVisitor(v);
        handlers.onVisitor(null);
      });
      es.addEventListener("packages", (e) => handlers.onPackages(JSON.parse(e.data)));
      es.addEventListener("resident", (e) => handlers.onResident?.(JSON.parse(e.data)));
      es.onerror = (err) => handlers.onError?.(err);

      const initial = async () => {
        try {
          handlers.onVisitor(await liveFetch(endpoint("visitorAlerts")));
          handlers.onPackages(await liveFetch(endpoint("packages")));
        } catch (err) {
          handlers.onError?.(err);
        }
      };
      initial();
      return () => es.close();
    }

    mock.on("visitor", handlers.onVisitor);
    mock.on("packages", handlers.onPackages);
    mock.simulate();
    return () => {};
  },

  async decideVisitor(visitorId, approve) {
    if (API_CONFIG.MODE === "live") {
      return liveFetch(endpoint("visitorDecision", { id: visitorId }), {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
    }
    return mock.sendDecision(visitorId, approve);
  },

  attachLiveAudio(visitorId, audioEl, onStatus) {
    if (API_CONFIG.MODE === "live") {
      // Chunked HTTP WAV stream from the simulated concierge intercom.
      // When the building supplies the real transport (WebRTC / WebSocket),
      // swap this for that connection using API_CONFIG.AUDIO_TRANSPORT.
      audioEl.src = endpoint("audioStream", { id: visitorId });
      audioEl.srcObject = null;
      audioEl.play().catch(() => {});
      onStatus("live from concierge intercom");
      return () => {
        audioEl.pause();
        audioEl.removeAttribute("src");
        audioEl.load();
      };
    }
    return mock.attachLiveAudio(audioEl, onStatus);
  },
};
