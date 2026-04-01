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

function buildContractUrl(baseUrl, path, params = {}) {
  const url = new URL(baseUrl);
  const cleanPath = String(path || "").replace(/^\/+/, "");
  url.pathname = url.pathname.replace(/\/$/, "") + (cleanPath ? "/" + cleanPath : "");

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, v);
    }
  });

  return url.toString();
}

function buildLegacyGasUrl(baseUrl, path, params = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("path", path);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, v);
    }
  });

  return url.toString();
}

function isGasDefaultPayload(json) {
  return Boolean(
    json &&
    json.ok === true &&
    json.data &&
    json.data.status === "ok" &&
    typeof json.data.message === "string" &&
    json.data.message.includes("GAS Backend API is running")
  );
}

function isEndpointNotFoundPayload(json) {
  const error = String(json && json.error ? json.error : "");
  return /endpoint_not_found|unknown endpoint|not found/i.test(error);
}

async function fetchGasJson(baseUrl, path, options = {}) {
  const {
    method = "GET",
    params = {},
    body = undefined,
    cache = undefined,
    headers = undefined,
  } = options;

  const urls = [
    buildContractUrl(baseUrl, path, params),
    buildLegacyGasUrl(baseUrl, path, params),
  ];

  let lastError = null;

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], {
        method,
        redirect: "follow",
        cache,
        headers,
        body,
      });

      const text = await res.text();
      const json = JSON.parse(text);

      if (i === 0 && (isGasDefaultPayload(json) || isEndpointNotFoundPayload(json))) {
        lastError = new Error(json.error || json.data.message || "Endpoint fallback");
        continue;
      }

      return json;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to fetch");
}

/**
 * Helper: kirim GET request ke GAS API
 */
async function apiGet(path, params = {}) {
  checkApiBase();
  const json = await fetchGasJson(getApiBaseUrl(), path, {
    method: "GET",
    params,
    cache: "no-store",
  });
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
  const json = await fetchGasJson(getApiBaseUrl(), path, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
  });
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
 * Batch send accelerometer data using contract endpoint
 * @param {Object} data - { device_id, data: [{x,y,z,ts},...], ts }
 * @returns {Promise<{accepted: number}>}
 */
async function apiBatchAccel(data) {
  return apiPost("telemetry/accel", {
    device_id: data.device_id,
    ts: data.ts || new Date().toISOString(),
    samples: (data.data || []).map((sample) => ({
      x: sample.x,
      y: sample.y,
      z: sample.z,
      t: sample.ts || sample.t || new Date().toISOString(),
    })),
  });
}

/**
 * Log single GPS reading
 * @param {Object} data - { device_id, lat, lng, accuracy_m?, accuracy?, altitude?, ts? }
 * @returns {Promise<{accepted: boolean}>}
 */
async function apiLogGPS(data) {
  return apiPost("telemetry/gps", {
    device_id: data.device_id,
    lat: data.lat,
    lng: data.lng,
    accuracy_m: data.accuracy_m ?? data.accuracy ?? "",
    altitude: data.altitude || "",
    mode: data.mode || "",
    ts: data.ts || new Date().toISOString(),
  });
}

async function apiStopLiveGps(deviceId, ts) {
  return apiPost("telemetry/gps/live/stop", {
    device_id: deviceId,
    ts: ts || new Date().toISOString(),
  });
}

/**
 * Get latest GPS marker for one device — contract endpoint
 * @param {string} deviceId
 * @returns {Promise<Object>}
 */
async function apiGetGpsMarker(deviceId) {
  return apiGet("telemetry/gps/latest", {
    device_id: deviceId,
    _t: Date.now()
  });
}

async function apiGetGpsLiveUsers(activeWithinSec = LIVE_LOC_ACTIVE_WINDOW_SEC) {
  const data = await apiGet("telemetry/gps/latest", {
    active_within_sec: activeWithinSec,
    _t: Date.now()
  });
  return ensureGpsEndpointPayload("telemetry/gps/latest", data);
}

// Backward compatibility:
// - no arg / numeric arg => daftar device live (perilaku lama live loc)
// - string arg => latest point untuk device tersebut
async function apiGetGpsLatest(deviceIdOrActiveWithinSec = LIVE_LOC_ACTIVE_WINDOW_SEC) {
  if (typeof deviceIdOrActiveWithinSec === "string") {
    return apiGetGpsMarker(deviceIdOrActiveWithinSec);
  }
  return apiGetGpsLiveUsers(deviceIdOrActiveWithinSec);
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
  const history = await apiGetGpsHistory(deviceId, 500, from, to);
  return {
    device_id: history.device_id,
    points: history.items
  };
}

/**
 * POST batch accelerometer telemetry data
 * Pattern from client.html — no Content-Type header (avoids CORS preflight)
 */
async function apiPostAccelTelemetry(payload) {
  const json = await fetchGasJson(getTelemetryApiUrl(), "telemetry/accel", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload),
  });
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}

/**
 * GET latest accelerometer reading — pattern from viewer.html
 */
async function apiGetAccelLatest(deviceId) {
  const json = await fetchGasJson(getTelemetryApiUrl(), "telemetry/accel/latest", {
    method: "GET",
    params: { device_id: deviceId },
  });
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}

/**
 * GET all registered device IDs — pattern from viewer.html
 */
async function apiGetAccelDevices() {
  const json = await fetchGasJson(getTelemetryApiUrl(), "telemetry/accel/devices", {
    method: "GET",
  });
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}
