
const SPREADSHEET_ID = '1BxNXy6JwtlsV07_yg7u30OcNe5skqGH8hkzHiwxR5zw';

const SHEET = {
    TOKENS: 'tokens',
    PRESENCE: 'presence',
    ACCEL: 'accel',
    GPS: 'gps',
    GPS_LIVE: 'gps_live',
};

const HEADERS = {
    [SHEET.TOKENS]: ['qr_token', 'course_id', 'session_id', 'created_at', 'expires_at', 'used'],
    [SHEET.PRESENCE]: ['presence_id', 'user_id', 'device_id', 'course_id', 'session_id', 'qr_token', 'ts', 'recorded_at'],
    [SHEET.ACCEL]: ['device_id', 'x', 'y', 'z', 'sample_ts', 'batch_ts', 'recorded_at'],
    [SHEET.GPS]: ['device_id', 'lat', 'lng', 'accuracy', 'altitude', 'ts', 'recorded_at', 'mode'],
    [SHEET.GPS_LIVE]: ['device_id', 'lat', 'lng', 'accuracy', 'altitude', 'ts', 'recorded_at', 'is_active'],
};

// WAKTU TOKEN: 30 DETIK
const QR_TOKEN_TTL_MS = 30 * 1000; 
const LIVE_LOC_ACTIVE_WINDOW_SEC = 15;

function normalizeRequestPath(value) {
    return String(value || '').replace(/^\/+|\/+$/g, '');
}

function resolveRequestPath(e, fallbackPath) {
    const fallback = normalizeRequestPath(fallbackPath);
    if (!e) return fallback;

    const pathInfo = normalizeRequestPath(e.pathInfo);
    if (pathInfo) return pathInfo;

    const queryPath = normalizeRequestPath(e.parameter && e.parameter.path);
    if (queryPath) return queryPath;

    return fallback;
}

function doGet(e) {
    try {
        const path = resolveRequestPath(e, 'ui');
        const params = e ? e.parameter : {};

        switch (path) {
             case 'telemetry/gps/history':
                return sendSuccess(getGpsHistory(params.device_id, params.limit, params.from, params.to));
             case 'telemetry/gps/latest': 
                return sendSuccess(getLatestGPS(params.active_within_sec));
            case 'presence/status':
                return sendSuccess(getPresenceStatus(params.user_id, params.course_id, params.session_id));
            case 'presence/list':
                return sendSuccess(getPresenceList(params.course_id, params.session_id));
            case 'sensor/gps/marker':
                return sendSuccess(getGpsMarker(params.device_id));
            case 'sensor/gps/polyline':
                return sendSuccess(getGpsPolyline(params.device_id, params.from, params.to));
            case 'telemetry/accel/latest':
                return sendSuccess(accelLatest(params.device_id));
            case 'telemetry/accel/devices':
                return sendSuccess(accelDevices());
            case 'ui':
                return HtmlService.createHtmlOutputFromFile('Index')
                    .setTitle('Dashboard Presensi Dosen')
                    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
            case 'scan':
                return HtmlService.createHtmlOutputFromFile('Scan')
                    .setTitle('Scanner Presensi Mahasiswa')
                    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
            default:
                return sendSuccess({ status: 'ok', message: 'GAS Backend API is running.' });
        }
    } catch (err) {
        return sendError(err.message);
    }
}

function doPost(e) {
    try {
        const path = resolveRequestPath(e, '');
        const body = e && e.postData ? JSON.parse(e.postData.contents) : {};

        switch (path) {
            case 'presence/qr/generate': return sendSuccess(generateQRToken(body));
            case 'presence/checkin': return sendSuccess(checkin(body));
            case 'sensor/accel/batch': return sendSuccess(batchAccel(body));
            case 'telemetry/accel': return sendSuccess(telemetryAccelBatch(body));
            case 'telemetry/gps': return sendSuccess(logGPS(body));
            case 'sensor/gps': return sendSuccess(logGPS(body));
            case 'telemetry/gps/live/stop': return sendSuccess(stopLiveGPS(body));
            case 'sensor/gps/live/stop': return sendSuccess(stopLiveGPS(body));
            default: return sendError('Unknown endpoint');
        }
    } catch (err) {
        return sendError(err.message);
    }
}

function generateQRToken(body) {
    if (!body.course_id || !body.session_id) throw new Error('Missing fields');
    const sheet = getOrCreateSheet(SHEET.TOKENS);
    const now = body.ts ? new Date(body.ts) : new Date();
    const expiresAt = new Date(now.getTime() + QR_TOKEN_TTL_MS);
    const qrToken = 'TKN-' + Utilities.getUuid().substring(0, 6).toUpperCase();
    
    sheet.appendRow([qrToken, body.course_id, body.session_id, now.toISOString(), expiresAt.toISOString(), false]);
    return { qr_token: qrToken, expires_at: expiresAt.toISOString() };
}

function processGenerateQR(payload) {
    try {
        const result = generateQRToken(payload);
        return { ok: true, data: result };
    } catch (error) { 
        return { ok: false, error: error.message }; 
    }
}

function checkin(body) {
    // Scanner cuma perlu kirim user_id dan qr_token
    if (!body.user_id || !body.qr_token) throw new Error('Missing fields');
    
    const tokensSheet = getOrCreateSheet(SHEET.TOKENS);
    const tokensData = tokensSheet.getDataRange().getValues();
    let tokenValid = false;
    let activeCourseId = '';
    let activeSessionId = '';
    const checkTime = body.ts ? new Date(body.ts) : new Date();

    // 1. Cari token di database untuk mendeteksi Mata Kuliah & Sesi secara otomatis
    for (let i = 1; i < tokensData.length; i++) {
        if (tokensData[i][0] === body.qr_token) {
            if (checkTime > new Date(tokensData[i][4])) throw new Error('token_expired');
            tokenValid = true;
            activeCourseId = tokensData[i][1]; // Ambil nama matkul dari database
            activeSessionId = tokensData[i][2]; // Ambil sesi dari database
            break; 
        }
    }
    
    if (!tokenValid) throw new Error('token_invalid');

    // 2. Mencegah absen ganda di matkul & sesi yang sama
    const presenceSheet = getOrCreateSheet(SHEET.PRESENCE);
    const presenceData = presenceSheet.getDataRange().getValues();
    for (let i = 1; i < presenceData.length; i++) {
        if (presenceData[i][1] === body.user_id && presenceData[i][3] === activeCourseId && presenceData[i][4] === activeSessionId) {
            return { presence_id: presenceData[i][0], status: 'already_checked_in' };
        }
    }

    // 3. Catat Kehadiran menggunakan matkul & sesi yang terdeteksi
    const presenceId = 'PR-' + Utilities.getUuid().substring(0, 4).toUpperCase();
    presenceSheet.appendRow([presenceId, body.user_id, body.device_id || 'web-scanner', activeCourseId, activeSessionId, body.qr_token, checkTime.toISOString(), nowISO()]);
    
    return { presence_id: presenceId, status: 'checked_in' };
}

function processCheckinUI(payload) {
    try {
        const result = checkin(payload);
        return { ok: true, data: result };
    } catch (error) { 
        return { ok: false, error: error.message }; 
    }
}

function getPresenceStatus(userId, courseId, sessionId) {
    const sheet = getOrCreateSheet(SHEET.PRESENCE);
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][1] === userId && data[i][3] === courseId && data[i][4] === sessionId) {
            return { user_id: userId, course_id: courseId, session_id: sessionId, status: 'checked_in', last_ts: data[i][6] };
        }
    }
    return { status: 'not_checked_in' };
}

function getPresenceList(courseId, sessionId) {
    if (!courseId || !sessionId) throw new Error('Missing fields: course_id, session_id');
    const sheet = getOrCreateSheet(SHEET.PRESENCE);
    const data = sheet.getDataRange().getValues();
    const students = [];
    for (let i = 1; i < data.length; i++) {
        if (data[i][3] === courseId && data[i][4] === sessionId) {
            students.push({
                presence_id: data[i][0],
                user_id: data[i][1],
                device_id: data[i][2],
                ts: data[i][6],
            });
        }
    }
    return { course_id: courseId, session_id: sessionId, count: students.length, students: students };
}

// --- FUNGSI AMBIL DATA REAL-TIME ---
function getSessionPresenceData(courseId, sessionId) {
    try {
        const sheet = getOrCreateSheet(SHEET.PRESENCE);
        const data = sheet.getDataRange().getValues();
        let users = [];
        for (let i = 1; i < data.length; i++) {
            if (data[i][3] === courseId && data[i][4] === sessionId) {
                users.push(data[i][1]); // Memasukkan user_id yang cocok
            }
        }
        return { ok: true, data: users };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

// ============================================================
// 3. FUNGSI SENSOR (MODUL 2 & 3)
// ============================================================

function batchAccel(body) {
    if (!body.device_id || !body.data) throw new Error('Missing fields');
    const sheet = getOrCreateSheet(SHEET.ACCEL);
    const batchTs = body.ts || nowISO();
    
    body.data.forEach(d => {
        sheet.appendRow([body.device_id, d.x, d.y, d.z, d.ts, batchTs, nowISO()]);
    });
    
    return { saved: body.data.length };
}

function hasGpsValue(value) {
    return value !== '' && value !== null && value !== undefined;
}

function normalizeDeviceId(value) {
    return String(value === null || value === undefined ? '' : value).trim();
}

function parsePositiveInt(value, fallbackValue) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parseOptionalDate(value) {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function gpsModeIncludes(modeValue, targetMode) {
    return String(modeValue || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .includes(targetMode);
}

function upsertLiveGPS(body, isActive) {
    const normalizedDeviceId = normalizeDeviceId(body.device_id);
    if (!normalizedDeviceId) throw new Error('Missing field: device_id');

    const sheet = getOrCreateSheet(SHEET.GPS_LIVE);
    const data = sheet.getDataRange().getValues();
    const nowIso = nowISO();
    const eventTs = body.ts || nowIso;
    const eventTsMs = parseOptionalDate(eventTs) || parseOptionalDate(nowIso) || Date.now();
    const rowValues = [
        normalizedDeviceId,
        hasGpsValue(body.lat) ? body.lat : '',
        hasGpsValue(body.lng) ? body.lng : '',
        body.accuracy || '',
        body.altitude || '',
        eventTs,
        nowIso,
        isActive ? 'true' : 'false'
    ];

    for (let i = data.length - 1; i >= 1; i--) {
        if (normalizeDeviceId(data[i][0]) === normalizedDeviceId) {
            const existingEventTsMs = parseOptionalDate(data[i][5]) || parseOptionalDate(data[i][6]) || 0;
            const shouldOverwrite =
                eventTsMs > existingEventTsMs ||
                (eventTsMs === existingEventTsMs && !isActive);

            if (!shouldOverwrite) {
                return {
                    device_id: normalizedDeviceId,
                    active: String(data[i][7]).toLowerCase() === 'true',
                    ignored: true
                };
            }

            sheet.getRange(i + 1, 1, 1, rowValues.length).setValues([rowValues]);
            return { device_id: normalizedDeviceId, active: isActive };
        }
    }

    sheet.appendRow(rowValues);
    return { device_id: normalizedDeviceId, active: isActive };
}

function logGPS(body) {
    const normalizedDeviceId = normalizeDeviceId(body.device_id);
    if (!normalizedDeviceId || !hasGpsValue(body.lat) || !hasGpsValue(body.lng)) throw new Error('Missing fields');
    const sheet = getOrCreateSheet(SHEET.GPS);
    
    sheet.appendRow([normalizedDeviceId, body.lat, body.lng, body.accuracy || '', body.altitude || '', body.ts || nowISO(), nowISO(), body.mode || '']);

    if (gpsModeIncludes(body.mode, 'live_loc')) {
        upsertLiveGPS(Object.assign({}, body, { device_id: normalizedDeviceId }), true);
    }

    return { recorded: true };
}
function getLatestGPS(activeWithinSec) {
    const sheet = getOrCreateSheet(SHEET.GPS_LIVE);
    const data = sheet.getDataRange().getValues();
    let allUsers = {};
    let processedDevices = {};
    const nowMs = Date.now();
    const activeWindowMs = parsePositiveInt(activeWithinSec, LIVE_LOC_ACTIVE_WINDOW_SEC) * 1000;
    
    for (let i = data.length - 1; i >= 1; i--) {
        const deviceId = normalizeDeviceId(data[i][0]);
        const lat = data[i][1];
        const lng = data[i][2];
        const ts = data[i][5]; 
        const recordedAt = data[i][6];
        const isActive = String(data[i][7]).toLowerCase() === 'true';
        const seenAt = recordedAt || ts;
        
        if (!deviceId || processedDevices[deviceId]) continue;
        processedDevices[deviceId] = true;
        if (!isActive) continue;
        if (!seenAt) continue;

        const seenAtMs = new Date(seenAt).getTime();
        if (!Number.isFinite(seenAtMs) || (nowMs - seenAtMs) > activeWindowMs) continue;

        if (hasGpsValue(lat) && hasGpsValue(lng)) {
            allUsers[deviceId] = { lat: lat, lng: lng, ts: ts, recorded_at: recordedAt };
        }
    }
    return allUsers; 
}
function getGpsMarker(deviceId) { return { status: "ok", device_id: deviceId }; }
function stopLiveGPS(bodyOrDeviceId) {
    if (bodyOrDeviceId && typeof bodyOrDeviceId === 'object') {
        return upsertLiveGPS({
            device_id: normalizeDeviceId(bodyOrDeviceId.device_id),
            ts: bodyOrDeviceId.ts || nowISO()
        }, false);
    }

    return upsertLiveGPS({
        device_id: normalizeDeviceId(bodyOrDeviceId),
        ts: nowISO()
    }, false);
}
function getGpsHistory(deviceId, limit, from, to) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) throw new Error('Missing field: device_id');

    const sheet = getOrCreateSheet(SHEET.GPS);
    const data = sheet.getDataRange().getValues();
    let items = [];
    
    // Default ambil 50 titik terakhir jika parameter limit tidak diisi
    const maxData = parsePositiveInt(limit, 50);
    const fromMs = parseOptionalDate(from);
    const toMs = parseOptionalDate(to);

    // Looping dari baris paling bawah (data terbaru) ke atas
    for (let i = data.length - 1; i >= 1; i--) {
        if (normalizeDeviceId(data[i][0]) === normalizedDeviceId) {
            const pointTs = data[i][5] || data[i][6];
            const pointMs = parseOptionalDate(pointTs);

            if (fromMs !== null && (pointMs === null || pointMs < fromMs)) continue;
            if (toMs !== null && (pointMs === null || pointMs > toMs)) continue;

            items.push({
                ts: data[i][5],   // Timestamp dari HP
                lat: data[i][1],  // Latitude
                lng: data[i][2]   // Longitude
            });

            if (items.length >= maxData) break; 
        }
    }

    // Balik array agar titik awal di depan (untuk menggambar garis)
    return {
        device_id: normalizedDeviceId,
        items: items.reverse()
    };
}

function getGpsPolyline(deviceId, from, to) {
    const history = getGpsHistory(deviceId, 500, from, to);
    return {
        device_id: history.device_id,
        points: history.items
    };
}


// ============================================================
// TELEMETRY ACCEL (POST batch + GET latest)
// Endpoint format sesuai spesifikasi tugas
// ============================================================

function telemetryAccelBatch(body) {
    const deviceId = normalizeDeviceId(body.device_id);
    if (!deviceId) throw new Error('Missing field: device_id');
    if (!Array.isArray(body.samples)) throw new Error('Missing field: samples');

    const sheet = getOrCreateSheet(SHEET.ACCEL);
    const batchTs = body.ts || nowISO();

    body.samples.forEach(s => {
        if (!s || !s.t || s.x === undefined || s.y === undefined || s.z === undefined) {
            throw new Error('Invalid sample payload');
        }

        sheet.appendRow([
            deviceId,
            Number(s.x),
            Number(s.y),
            Number(s.z),
            s.t,
            batchTs,
            nowISO()
        ]);
    });
    
    return { accepted: body.samples.length };
}

function accelLatest(deviceId) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) throw new Error('Missing field: device_id');
    const sheet = getOrCreateSheet(SHEET.ACCEL);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = rows.length - 1; i >= 1; i--) {
        if (normalizeDeviceId(rows[i][0]) === normalizedDeviceId) {
            return {
                t: rows[i][4],
                x: Number(rows[i][1]),
                y: Number(rows[i][2]),
                z: Number(rows[i][3])
            };
        }
    }
    throw new Error('device_not_found');
}

function accelDevices() {
    const sheet = getOrCreateSheet(SHEET.ACCEL);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
        return { devices: [] };
    }

    const rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const devices = [...new Set(rows.map(r => String(r[0] || '').trim()).filter(Boolean))];
    return { devices: devices };
}

// ============================================================
// 4. HELPER UTILITY
// ============================================================

function sendSuccess(data) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data })).setMimeType(ContentService.MimeType.JSON);
}

function sendError(message) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message || 'Internal server error' })).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateSheet(name) {
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        const headers = HEADERS[name];
        if (headers) {
            sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
            sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4a86e8').setFontColor('#ffffff');
            sheet.setFrozenRows(1);
        }
    }
    return sheet;
}

function nowISO() { return new Date().toISOString(); }
