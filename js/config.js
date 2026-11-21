// Concierge API configuration.
// MODE "live" points the resident app at the local simulated concierge
// service (server/server.js). Switch MODE to "mock" for a fully in-browser
// demo without any server.
export const API_CONFIG = {
  MODE: "live", // "mock" | "live"

  BASE_URL: "/api", // local simulated concierge service (loopback)
  AUTH_TOKEN: "demo-token",

  ENDPOINTS: {
    register: "/residents",
    visitorAlerts: "/visitors/alerts",
    visitorDecision: "/visitors/{id}/decision",
    audioStream: "/visitors/{id}/audio",
    packages: "/packages",
    events: "/events", // SSE: "visitor", "packages", "resident", "cleared"
  },

  // Real-time audio delivery from the concierge system:
  // "wav-stream" (chunked HTTP WAV, used by the simulator),
  // "webrtc" or "ws" once the building supplies the real transport.
  AUDIO_TRANSPORT: "wav-stream",
};
