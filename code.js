// ─── KONFIGURASI ────────────────────────────────────────────
const SPREADSHEET_ID = "1gsw8MIzKZcJrBASL1FNozQVNNTeNtNXTWM95Majtvbw";
const SHEET_TOKENS = "tokens";
const SHEET_PRESENCE = "presence";
const QR_EXPIRY_MS = 2 * 60 * 1000; // 2 menit

// ─── ENTRY POINTS ───────────────────────────────────────────
function doGet(e) {
  try {
    return routeRequest("GET", e);
  } catch (err) {
    return jsonError(err.message);
  }
}

function doPost(e) {
  try {
    return routeRequest("POST", e);
  } catch (err) {
    return jsonError(err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  BUSINESS LOGIC
// ═══════════════════════════════════════════════════════════════

// ─── GENERATE QR TOKEN ──────────────────────────────────────
// Dipanggil oleh route.gs & google.script.run dari index.html
// Body: { course_id, session_id, ts }
// Return: { qr_token, qr_url, expires_at }
function generateQrToken(body) {
  if (!body.course_id) throw new Error("missing_field: course_id");
  if (!body.session_id) throw new Error("missing_field: session_id");

  const token =
    "TKN-" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + QR_EXPIRY_MS).toISOString();

  const sheet = getSheet(SHEET_TOKENS);
  // Kolom: token, course_id, session_id, created_at, expires_at, is_used
  sheet.appendRow([
    token,
    body.course_id,
    body.session_id,
    new Date().toISOString(),
    expiresAt,
    false,
  ]);

  // Build QR URL yang bisa langsung di-scan mahasiswa
  const baseUrl = ScriptApp.getService().getUrl();
  const qrUrl =
    baseUrl +
    "?path=scan" +
    "&token=" +
    encodeURIComponent(token) +
    "&course_id=" +
    encodeURIComponent(body.course_id) +
    "&session_id=" +
    encodeURIComponent(body.session_id);

  return {
    qr_token: token,
    qr_url: qrUrl,
    expires_at: expiresAt,
  };
}

// ─── CHECK-IN PRESENSI ──────────────────────────────────────
// Dipanggil oleh route.gs & google.script.run dari mahasiswa.html
// Body: { qr_token, user_id, device_id, course_id, session_id, ts }
// Return: { presence_id, status }
function checkinPresence(body) {
  if (!body.qr_token) throw new Error("missing_field: qr_token");
  if (!body.user_id) throw new Error("missing_field: user_id");

  // Validasi token
  const sheetTokens = getSheet(SHEET_TOKENS);
  const data = sheetTokens.getDataRange().getValues();
  // Kolom: 0=token, 1=course_id, 2=session_id, 3=created_at, 4=expires_at, 5=is_used

  let valid = false;
  let expires;
  let tokenRow = -1;
  let sessionId = "";

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.qr_token) {
      valid = true;
      expires = new Date(data[i][4]); // expires_at
      tokenRow = i + 1;
      sessionId = data[i][2]; // session_id

      // Cek apakah token sudah dipakai
      if (data[i][5] === true || data[i][5] === "TRUE") {
        throw new Error("Token sudah digunakan");
      }
      break;
    }
  }

  if (!valid) throw new Error("Token tidak ditemukan");
  if (new Date() > expires) throw new Error("Token sudah kedaluwarsa");

  // Cek duplikat
  const presenceSheet = getSheet(SHEET_PRESENCE);
  const presenceData = presenceSheet.getDataRange().getValues();
  // Kolom: 0=user_id, 1=device_id, 2=course_id, 3=session_id, 4=qr_token, 5=ts

  for (let i = 1; i < presenceData.length; i++) {
    if (
      presenceData[i][0] === body.user_id &&
      presenceData[i][3] === sessionId
    ) {
      throw new Error("Anda sudah check-in di session ini");
    }
  }

  // Simpan presensi
  presenceSheet.appendRow([
    body.user_id,
    body.device_id || "",
    body.course_id || "",
    sessionId,
    body.qr_token,
    new Date().toISOString(),
  ]);

  // Tandai token sebagai sudah digunakan
  sheetTokens.getRange(tokenRow, 6).setValue(true);

  return {
    presence_id: "PR-" + new Date().getTime(),
    status: "checked_in",
  };
}

// ─── GET PRESENCE STATUS ────────────────────────────────────
// Dipanggil oleh route.gs & google.script.run dari mahasiswa.html
// Params: { user_id, course_id, session_id }
// Return: { user_id, course_id, session_id, status, last_ts? }
function getPresenceStatus(params) {
  const sheet = getSheet(SHEET_PRESENCE);
  const data = sheet.getDataRange().getValues();
  // Kolom: 0=user_id, 1=device_id, 2=course_id, 3=session_id, 4=qr_token, 5=ts

  for (let i = data.length - 1; i >= 1; i--) {
    if (
      data[i][0] === params.user_id &&
      data[i][2] === params.course_id &&
      data[i][3] === params.session_id
    ) {
      return {
        user_id: params.user_id,
        course_id: params.course_id,
        session_id: params.session_id,
        status: "checked_in",
        last_ts: data[i][5],
      };
    }
  }

  return {
    user_id: params.user_id,
    course_id: params.course_id,
    session_id: params.session_id,
    status: "not_found",
  };
}

// ─── SETUP SHEETS ───────────────────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Sheet tokens
  let tokSheet = ss.getSheetByName(SHEET_TOKENS);
  if (!tokSheet) {
    tokSheet = ss.insertSheet(SHEET_TOKENS);
    tokSheet.appendRow([
      "token",
      "course_id",
      "session_id",
      "created_at",
      "expires_at",
      "is_used",
    ]);
  }

  // Sheet presence
  let presSheet = ss.getSheetByName(SHEET_PRESENCE);
  if (!presSheet) {
    presSheet = ss.insertSheet(SHEET_PRESENCE);
    presSheet.appendRow([
      "user_id",
      "device_id",
      "course_id",
      "session_id",
      "qr_token",
      "ts",
    ]);
  }

  Logger.log('✅ Sheet "tokens" dan "presence" berhasil dibuat/ditemukan.');
}
