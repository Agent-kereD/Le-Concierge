// Resident app: setup flow, visitor interaction, package notifications.
import { conciergeApi } from "./api.js";

const $ = (id) => document.getElementById(id);

const els = {
  setupSection: $("setupSection"),
  dashboardSection: $("dashboardSection"),
  residentBadge: $("residentBadge"),
  stepAnonymity: $("stepAnonymity"),
  stepDetails: $("stepDetails"),
  stepDone: $("stepDone"),
  setupError: $("setupError"),
  setupDoneMsg: $("setupDoneMsg"),
  visitorAlert: $("visitorAlert"),
  noVisitor: $("noVisitor"),
  visitorName: $("visitorName"),
  visitorPhoto: $("visitorPhoto"),
  visitorMsg: $("visitorMsg"),
  liveAudio: $("liveAudio"),
  audioStatus: $("audioStatus"),
  btnApprove: $("btnApprove"),
  btnDeny: $("btnDeny"),
  visitorLog: $("visitorLog"),
  packageLog: $("packageLog"),
  noPackages: $("noPackages"),
};

let anonymous = false;
let currentVisitor = null;
let stopAudio = null;

// ---------------- setup flow ----------------

document.querySelectorAll(".choice").forEach((btn) => {
  btn.addEventListener("click", () => {
    anonymous = btn.dataset.anon === "true";
    if (anonymous) finishSetup({ anonymous: true });
    else showStep(els.stepDetails);
  });
});

$("btnBackAnon").addEventListener("click", () => showStep(els.stepAnonymity));

els.stepDetails.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("inpName").value.trim();
  const flat = $("inpFlat").value.trim();
  if (!name || !flat) return showSetupError("Please supply both your name and flat number.");
  hide(els.setupError);

  const whatsapp = $("inpWhatsapp").checked;
  const phone = $("inpPhone").value.trim();
  if (whatsapp && !phone) {
    return showSetupError("Please supply a phone number to enable WhatsApp notifications.");
  }

  const profile = {
    anonymous: false,
    name,
    flat,
    email: $("inpEmail").value.trim() || null,
    phone: phone || null,
    whatsapp: whatsapp || null,
  };
  await conciergeApi.registerResident(profile);
  finishSetup(profile);
});

function showSetupError(msg) {
  els.setupError.textContent = msg;
  els.setupError.classList.remove("hidden");
}

function finishSetup(profile) {
  if (profile.anonymous) {
    const id = "anon-" + Math.random().toString(36).slice(2, 8);
    els.setupDoneMsg.textContent = `You are set up anonymously. The concierge will know you only as ${id}.`;
  } else {
    els.setupDoneMsg.textContent = `Thanks ${profile.name}! Flat ${profile.flat} is now registered with the concierge.`;
  }
  showStep(els.stepDone);
}

$("btnGoDashboard").addEventListener("click", openDashboard);

// ---------------- dashboard ----------------

function showStep(step) {
  [els.stepAnonymity, els.stepDetails, els.stepDone].forEach((s) =>
    s.classList.add("hidden")
  );
  step.classList.remove("hidden");
}

function show(el) {
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}

function openDashboard() {
  hide(els.setupSection);
  show(els.dashboardSection);

  const resident = JSON.parse(localStorage.getItem("concierge.resident") || "{}");
  els.residentBadge.textContent = resident.anonymous
    ? "Anonymous resident"
    : `${resident.name} · Flat ${resident.flat}`;
  show(els.residentBadge);

  conciergeApi.startEventFeed({
    onVisitor: handleVisitorAlert,
    onPackages: renderPackages,
    onError: (err) => console.error("Concierge feed error:", err),
  });
}

// ---------------- visitor interaction ----------------

function handleVisitorAlert(visitor) {
  if (visitor && visitor.status === "pending") {
    currentVisitor = visitor;
    els.visitorName.textContent = `${visitor.name} is at the door`;
    els.visitorPhoto.src = visitor.photo;
    els.visitorMsg.textContent = visitor.message;
    hide(els.noVisitor);
    show(els.visitorAlert);

    stopAudio?.();
    stopAudio = conciergeApi.attachLiveAudio(
      visitor.id,
      els.liveAudio,
      (status) => (els.audioStatus.textContent = status)
    );
  } else {
    if (visitor) addLog(els.visitorLog, visitor.decidedAt, visitor.status, visitor.name, true);
    currentVisitor = null;
    stopAudio?.();
    stopAudio = null;
    hide(els.visitorAlert);
    show(els.noVisitor);
  }
}

async function decide(approve) {
  if (!currentVisitor) return;
  const v = currentVisitor;
  els.btnApprove.disabled = true;
  els.btnDeny.disabled = true;
  await conciergeApi.decideVisitor(v.id, approve);
  els.btnApprove.disabled = false;
  els.btnDeny.disabled = false;
  addLog(els.visitorLog, new Date().toISOString(), approve ? "approved" : "denied", v.name, true);
  currentVisitor = null;
  stopAudio?.();
  stopAudio = null;
  hide(els.visitorAlert);
  show(els.noVisitor);
}

els.btnApprove.addEventListener("click", () => decide(true));
els.btnDeny.addEventListener("click", () => decide(false));

// ---------------- packages ----------------

function renderPackages(packages) {
  els.packageLog.innerHTML = "";
  if (!packages || packages.length === 0) return show(els.noPackages);
  hide(els.noPackages);
  packages.forEach((p) =>
    addLog(els.packageLog, p.droppedAt, "dropped off", `${p.courier} — ${p.note}`, false)
  );
}

// ---------------- shared ----------------

function addLog(list, isoTime, status, text, isVisitor) {
  const tpl = $("tplLogItem");
  const li = tpl.content.cloneNode(true);
  li.querySelector(".log-time").textContent = new Date(isoTime).toLocaleTimeString();
  const body = li.querySelector(".log-body");
  const cls = !isVisitor ? "" : status === "approved" ? "" : "denied";
  body.className = "log-body " + cls;
  body.innerHTML = `<strong>${escapeHtml(status)}</strong> ${escapeHtml(text)}`;
  list.prepend(li);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".tab-body").forEach((b) => b.classList.add("hidden"));
    show($("tab-" + tab.dataset.tab));
  });
});

// If already registered, go straight to the dashboard.
if (conciergeApi.isRegistered()) openDashboard();
