// ═══════════════════════════════════════════════
//  API Module — fetch() wrapper for GAS Backend v5
// ═══════════════════════════════════════════════

// BACKEND UTAMA (backend-gas/)
// URL deployment Google Apps Script untuk Presensi QR + GPS + Accelerometer
const DEFAULT_API_BASE = "https://script.google.com/macros/s/AKfycbyNepWGdF-dVMOBVnv_4JXS4Ik1e2MHP8Pp3e4zd45ARqpMujrxg3gmIQbjt7xbk7Yz3A/exec";

// Default telemetry sekarang ikut backend utama agar cukup satu link GAS.
const DEFAULT_API_TELEMETRY = DEFAULT_API_BASE;
const LIVE_LOC_ACTIVE_WINDOW_SEC = 15;
const SWAP_TEST_STORAGE_KEY = "swap_test_config_v1";
const API_PROFILE_STORAGE_KEY = "active_api_profile";


// Validasi: apakah URL sudah diganti dari placeholder?
function checkApiBase() {
  if (getApiBaseUrl().includes('AKfycbxXXXXXXXX')) {
    throw new Error('API_BASE belum diatur! Buka file api.js dan ganti URL placeholder dengan URL deployment GAS kamu.');
  }
}

function normalizeApiUrl(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    return parsed.toString();
  } catch (error) {
    throw new Error("URL GAS tidak valid.");
  }
}

function getSwapTestConfig() {
  try {
    const raw = localStorage.getItem(SWAP_TEST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      apiBase: String(parsed.apiBase || "").trim(),
      apiTelemetry: String(parsed.apiTelemetry || "").trim()
    };
  } catch (error) {
    return { apiBase: "", apiTelemetry: "" };
  }
}

function saveSwapTestConfig(apiBase, apiTelemetry) {
  const nextConfig = {
    apiBase: normalizeApiUrl(apiBase),
    apiTelemetry: normalizeApiUrl(apiTelemetry)
  };

  localStorage.setItem(SWAP_TEST_STORAGE_KEY, JSON.stringify(nextConfig));
  return nextConfig;
}

function clearSwapTestConfig() {
  localStorage.removeItem(SWAP_TEST_STORAGE_KEY);
}

function setActiveApiProfile(profile) {
  localStorage.setItem(API_PROFILE_STORAGE_KEY, profile === "swap" ? "swap" : "default");
}

function getActiveApiProfile() {
  return localStorage.getItem(API_PROFILE_STORAGE_KEY) === "swap" ? "swap" : "default";
}

function disableSwapTestProfile() {
  setActiveApiProfile("default");
}

function canUseSwapTestProfile() {
  const config = getSwapTestConfig();
  return Boolean(config.apiBase);
}

function enableSwapTestProfile() {
  if (!canUseSwapTestProfile()) {
    throw new Error("Lengkapi minimal URL GAS utama terlebih dahulu.");
  }
  setActiveApiProfile("swap");
}

function getApiBaseUrl() {
  const config = getSwapTestConfig();
  if (getActiveApiProfile() === "swap" && config.apiBase) {
    return config.apiBase;
  }
  return DEFAULT_API_BASE;
}

function getTelemetryApiUrl() {
  const config = getSwapTestConfig();
  if (getActiveApiProfile() === "swap") {
    return config.apiTelemetry || config.apiBase || DEFAULT_API_TELEMETRY;
  }
  return DEFAULT_API_TELEMETRY;
}

/**
 * Helper: kirim GET request ke GAS API
 */
async function apiGet(path, params = {}) {
  checkApiBase();
  const url = new URL(getApiBaseUrl());
  url.searchParams.set("path", path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
  });

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}

function ensureGpsEndpointPayload(path, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Invalid response from ${path}`);
  }

  if (data.status === "ok" && typeof data.message === "string") {
    throw new Error(`Endpoint ${path} belum tersedia di deployment GAS aktif. Deploy ulang backend-gas.`);
  }

  return data;
}

/**
 * Helper: kirim POST request ke GAS API
 * GAS web apps redirect POST → GET (302), fetch handles with redirect: follow
 */
async function apiPost(path, body = {}) {
  checkApiBase();
  const url = new URL(getApiBaseUrl());
  url.searchParams.set("path", path);

  const res = await fetch(url.toString(), {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}

// ─── PRESENCE API ───

/**
 * Generate QR Token (Dosen)
 * @param {Object} data - { course_id, session_id }
 * @returns {Promise<{qr_token, expires_at}>}
 */
async function apiGenerateQrToken(data) {
  return apiPost("presence/qr/generate", {
    course_id: data.course_id,
    session_id: data.session_id,
    ts: new Date().toISOString(),
  });
}

/**
 * Check-in Presensi (Mahasiswa)
 * Backend auto-detects course/session from token
 * @param {Object} data - { qr_token, user_id, device_id }
 * @returns {Promise<{presence_id, status}>}
 */
async function apiCheckinPresence(data) {
  return apiPost("presence/checkin", {
    qr_token: data.qr_token,
    user_id: data.user_id,
    device_id: data.device_id,
    course_id: data.course_id,
    session_id: data.session_id,
    ts: new Date().toISOString(),
  });
}

/**
 * Cek Status Presensi (Mahasiswa)
 * @param {Object} params - { user_id, course_id, session_id }
 * @returns {Promise<{status, last_ts?}>}
 */
async function apiGetPresenceStatus(params) {
  return apiGet("presence/status", params);
}

/**
 * Get Session Presence Data (Dosen real-time list)
 * @param {string} courseId
 * @param {string} sessionId
 * @returns {Promise<string[]>} Array of user_ids yang sudah check-in
 */
async function apiGetSessionPresenceData(courseId, sessionId) {
  return apiGet("presence/list", {
    course_id: courseId,
    session_id: sessionId,
    _t: Date.now() // 👈 TAMBAHKAN BARIS INI (Trik Anti-Cache)
  });
}

// ─── SENSOR API ───

/**
 * Batch send accelerometer data
 * @param {Object} data - { device_id, data: [{x,y,z,ts},...], ts }
 * @returns {Promise<{saved: number}>}
 */
async function apiBatchAccel(data) {
  return apiPost("sensor/accel/batch", {
    device_id: data.device_id,
    data: data.data,
    ts: new Date().toISOString(),
  });
}

/**
 * Log single GPS reading
 * @param {Object} data - { device_id, lat, lng, accuracy?, altitude?, ts? }
 * @returns {Promise<{recorded: boolean}>}
 */
async function apiLogGPS(data) {
  return apiPost("sensor/gps", {
    device_id: data.device_id,
    lat: data.lat,
    lng: data.lng,
    accuracy: data.accuracy || "",
    altitude: data.altitude || "",
    mode: data.mode || "",
    ts: data.ts || new Date().toISOString(),
  });
}

async function apiStopLiveGps(deviceId, ts) {
  return apiPost("sensor/gps/live/stop", {
    device_id: deviceId,
    ts: ts || new Date().toISOString(),
  });
}

/**
 * Get latest GPS marker for device
 * @param {string} deviceId
 * @returns {Promise<Object>}
 */
async function apiGetGpsMarker(deviceId) {
  return apiGet("sensor/gps/marker", { device_id: deviceId });
}

async function apiGetGpsLatest(activeWithinSec = LIVE_LOC_ACTIVE_WINDOW_SEC) {
  const data = await apiGet("telemetry/gps/latest", {
    active_within_sec: activeWithinSec,
    _t: Date.now()
  });
  return ensureGpsEndpointPayload("telemetry/gps/latest", data);
}

async function apiGetGpsHistory(deviceId, limit = 50, from, to) {
  const data = await apiGet("telemetry/gps/history", {
    device_id: deviceId,
    limit,
    from,
    to,
    _t: Date.now(),
  });
  const payload = ensureGpsEndpointPayload("telemetry/gps/history", data);

  if (!Array.isArray(payload.items)) {
    throw new Error("Invalid response from telemetry/gps/history");
  }

  return payload;
}

/**
 * Get GPS polyline (trail) for device within time range
 * @param {string} deviceId
 * @param {string} from - ISO timestamp
 * @param {string} to - ISO timestamp
 * @returns {Promise<Object>}
 */
async function apiGetGpsPolyline(deviceId, from, to) {
  return apiGet("sensor/gps/polyline", { device_id: deviceId, from, to });
}

/**
 * POST batch accelerometer telemetry data
 * Pattern from client.html — no Content-Type header (avoids CORS preflight)
 */
async function apiPostAccelTelemetry(payload) {
  const url = new URL(getTelemetryApiUrl());
  url.searchParams.set("path", "telemetry/accel");

  const res = await fetch(url.toString(), {
    method: "POST",
    redirect: "follow",
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const json = JSON.parse(text);
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}

/**
 * GET latest accelerometer reading — pattern from viewer.html
 */
async function apiGetAccelLatest(deviceId) {
  const res = await fetch(
    `${getTelemetryApiUrl()}?path=telemetry/accel/latest&device_id=${encodeURIComponent(deviceId)}`,
    { redirect: "follow" }
  );
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}

/**
 * GET all registered device IDs — pattern from viewer.html
 */
async function apiGetAccelDevices() {
  const res = await fetch(
    `${getTelemetryApiUrl()}?path=telemetry/accel/devices`,
    { redirect: "follow" }
  );
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}
