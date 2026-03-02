// ═══════════════════════════════════════════════
//  API Module — fetch() wrapper for GAS Backend v5
// ═══════════════════════════════════════════════

// ⚠️ GANTI URL INI dengan URL deployment Google Apps Script kamu
// Cara mendapatkan:
//   1. Buka Apps Script → Deploy → Manage deployments
//   2. Copy URL web app (yang diakhiri /exec)
const API_BASE = "https://script.google.com/macros/s/AKfycbyNepWGdF-dVMOBVnv_4JXS4Ik1e2MHP8Pp3e4zd45ARqpMujrxg3gmIQbjt7xbk7Yz3A/exec";

// Validasi: apakah URL sudah diganti dari placeholder?
function checkApiBase() {
  if (API_BASE.includes('AKfycbxXXXXXXXX')) {
    throw new Error('API_BASE belum diatur! Buka file api.js dan ganti URL placeholder dengan URL deployment GAS kamu.');
  }
}

/**
 * Helper: kirim GET request ke GAS API
 */
async function apiGet(path, params = {}) {
  checkApiBase();
  const url = new URL(API_BASE);
  url.searchParams.set("path", path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
  });

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown error");
  return json.data;
}

/**
 * Helper: kirim POST request ke GAS API
 * GAS web apps redirect POST → GET (302), fetch handles with redirect: follow
 */
async function apiPost(path, body = {}) {
  checkApiBase();
  const url = new URL(API_BASE);
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
    ts: data.ts || new Date().toISOString(),
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
