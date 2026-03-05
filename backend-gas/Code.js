
const SPREADSHEET_ID = '1BxNXy6JwtlsV07_yg7u30OcNe5skqGH8hkzHiwxR5zw';

const SHEET = {
    TOKENS: 'tokens',
    PRESENCE: 'presence',
    ACCEL: 'accel',
    GPS: 'gps',
};

const HEADERS = {
    [SHEET.TOKENS]: ['qr_token', 'course_id', 'session_id', 'created_at', 'expires_at', 'used'],
    [SHEET.PRESENCE]: ['presence_id', 'user_id', 'device_id', 'course_id', 'session_id', 'qr_token', 'ts', 'recorded_at'],
    [SHEET.ACCEL]: ['device_id', 'x', 'y', 'z', 'sample_ts', 'batch_ts', 'recorded_at'],
    [SHEET.GPS]: ['device_id', 'lat', 'lng', 'accuracy', 'altitude', 'ts', 'recorded_at'],
};

// WAKTU TOKEN: 30 DETIK
const QR_TOKEN_TTL_MS = 30 * 1000; 

function doGet(e) {
    try {
        const path = (e.parameter && e.parameter.path) ? e.parameter.path : 'ui';
        const params = e ? e.parameter : {};

        switch (path) {
            case 'presence/status':
                return sendSuccess(getPresenceStatus(params.user_id, params.course_id, params.session_id));
            case 'sensor/gps/marker':
                return sendSuccess(getGpsMarker(params.device_id));
            case 'sensor/gps/polyline':
                return sendSuccess(getGpsPolyline(params.device_id, params.from, params.to));
            case 'telemetry/accel/latest':
                return sendSuccess(accelLatest(params.device_id));
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
        const path = (e.parameter && e.parameter.path) ? e.parameter.path : '';
        const body = e && e.postData ? JSON.parse(e.postData.contents) : {};

        switch (path) {
            case 'presence/qr/generate': return sendSuccess(generateQRToken(body));
            case 'presence/checkin': return sendSuccess(checkin(body));
            case 'sensor/accel/batch': return sendSuccess(batchAccel(body));
            case 'telemetry/accel': return sendSuccess(telemetryAccelBatch(body));
            case 'sensor/gps': return sendSuccess(logGPS(body));
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

function logGPS(body) {
    if (!body.device_id || !body.lat || !body.lng) throw new Error('Missing fields');
    const sheet = getOrCreateSheet(SHEET.GPS);
    
    sheet.appendRow([body.device_id, body.lat, body.lng, body.accuracy || '', body.altitude || '', body.ts || nowISO(), nowISO()]);
    return { recorded: true };
}

function getGpsMarker(deviceId) { return { status: "ok", device_id: deviceId }; }
function getGpsPolyline(deviceId, from, to) { return { status: "ok", device_id: deviceId }; }

// ============================================================
// TELEMETRY ACCEL (POST batch + GET latest)
// Endpoint format sesuai spesifikasi tugas
// ============================================================

function telemetryAccelBatch(body) {
    if (!body.device_id || !body.samples) throw new Error('Missing fields: device_id, samples');
    const sheet = getOrCreateSheet(SHEET.ACCEL);
    const batchTs = body.ts || nowISO();
    
    body.samples.forEach(s => {
        sheet.appendRow([body.device_id, s.x, s.y, s.z, s.t, batchTs, nowISO()]);
    });
    
    return { accepted: body.samples.length };
}

function accelLatest(deviceId) {
    if (!deviceId) throw new Error('Missing field: device_id');
    const sheet = getOrCreateSheet(SHEET.ACCEL);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = rows.length - 1; i >= 1; i--) {
        if (String(rows[i][0]) === String(deviceId)) {
            return {
                t: rows[i][4],
                x: rows[i][1],
                y: rows[i][2],
                z: rows[i][3]
            };
        }
    }
    throw new Error('device_not_found');
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