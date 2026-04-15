// ═══════════════════════════════════════════════
//  Presensi QR Dinamis — Main Application Logic
//  Integrated with GAS Backend v5
// ═══════════════════════════════════════════════

// ─── CONFIG ───
const QR_REFRESH_SECONDS = 30;

// ─── STATE ───
let qrTimerInterval = null;
let html5QrScanner = null;
let isPresenceRunning = false;
let activeCourseId = '';
let activeSessionId = '';
let scannedCourseId = '';
let scannedSessionId = '';
let pollingInterval = null;        
const POLLING_INTERVAL_MS = 3000;
const ATTENDANCE_HIDDEN_PREFIX = 'attendance_hidden';
let latestVisibleAttendanceRows = [];
let currentFeatureSourceMenu = 'role';

// ─── DEVICE ID ───
function getDeviceId() {
  let deviceId = localStorage.getItem('device_id');
  if (!deviceId) {
    deviceId = 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    localStorage.setItem('device_id', deviceId);
  }
  return deviceId;
}

// ─── VIEW MANAGEMENT ───
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + name);
  if (target) target.classList.add('active');

  const btnBack = document.getElementById('btnBack');
  if (name === 'role') {
    btnBack.classList.remove('visible');
    stopScanner();
    stopPresenceSession();
    stopAccel();
    stopGPS();
    stopAdminRefresh();
  } else {
    btnBack.classList.add('visible');
  }

  // Set correct back target based on hierarchy
  if (name === 'dosen' || name === 'mahasiswa') {
    // Dosen/Mahasiswa → back to Presensi QR sub-menu
    btnBack.onclick = function() { showView('presensi'); };
  } else if (name === 'accel-client' || name === 'accel-admin') {
    // Client/Admin → back to Accelerometer sub-menu
    btnBack.onclick = function() { showView('accel'); };
  } else if (name === 'presensi' || name === 'accel') {
    // Sub-menus → back to main menu
    btnBack.onclick = function() { showView(currentFeatureSourceMenu); };
    stopAccel();
    stopAdminRefresh();
  } else {
    btnBack.onclick = function() { showView('role'); };
  }

  // Auto-load devices when entering admin view
  if (name === 'accel-admin') {
    loadAdminDevices();
  }
  if (name === 'swap') {
    refreshSwapTestPanel();
  }
  if (name === 'gps') {
    document.getElementById('gpsDeviceIdDisplay').textContent = getDeviceId();
    initMapGps(); // Nyalakan peta saat menu GPS dibuka
  }
}

// ─── TOAST ───
function showToast(msg, type) {
  const box = document.getElementById('toastBox');
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ─── LOADING ───
function setLoading(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  if (on) {
    btn.disabled = true;
    btn._orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Memproses...';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn._orig || btn.innerHTML;
  }
}

// ─── ESCAPE ───
function esc(s) {
  return s ? String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;') : '';
}

function openDefaultPresensi() {
  disableSwapTestProfile();
  currentFeatureSourceMenu = 'role';
  showView('presensi');
}

function openDefaultAccel() {
  disableSwapTestProfile();
  currentFeatureSourceMenu = 'role';
  showView('accel');
}

function openDefaultGps() {
  disableSwapTestProfile();
  window.location.href = 'map-view.html';
}

function openSwapTestView() {
  currentFeatureSourceMenu = 'swap';
  showView('swap');
}

function getSwapTestInputValues() {
  const apiBaseInput = document.getElementById('swapApiBaseInput');
  const val = apiBaseInput ? apiBaseInput.value.trim() : '';

  return {
    apiBase: val,
    apiTelemetry: val
  };
}

function refreshSwapTestPanel() {
  const config = getSwapTestConfig();
  const apiBaseInput = document.getElementById('swapApiBaseInput');
  const statusText = document.getElementById('swapStatusText');

  if (apiBaseInput) apiBaseInput.value = config.apiBase || '';

  if (statusText) {
    statusText.textContent =
      getActiveApiProfile() === 'swap'
        ? 'Mode aktif: Swap Test'
        : 'Mode aktif: Server sendiri';
  }
}

function saveSwapTestLinks() {
  try {
    const inputs = getSwapTestInputValues();
    saveSwapTestConfig(inputs.apiBase, inputs.apiTelemetry);
    refreshSwapTestPanel();
    showToast('Link GAS swap test berhasil disimpan.', 'success');
  } catch (err) {
    showToast(err.message || 'Link GAS tidak valid.', 'error');
  }
}

function disableSwapTestMode() {
  disableSwapTestProfile();
  currentFeatureSourceMenu = 'role';
  refreshSwapTestPanel();
  showToast('Kembali menggunakan server sendiri.', 'info');
}

function prepareSwapTestProfile() {
  const inputs = getSwapTestInputValues();

  if (inputs.apiBase || inputs.apiTelemetry) {
    saveSwapTestConfig(inputs.apiBase, inputs.apiTelemetry);
  }

  enableSwapTestProfile();
  currentFeatureSourceMenu = 'swap';
  refreshSwapTestPanel();
}

function openSwapPresensi() {
  try {
    prepareSwapTestProfile();
    showView('presensi');
  } catch (err) {
    showToast(err.message || 'Lengkapi link GAS swap test terlebih dahulu.', 'error');
  }
}

function openSwapAccel() {
  try {
    prepareSwapTestProfile();
    showView('accel');
  } catch (err) {
    showToast(err.message || 'Lengkapi link GAS swap test terlebih dahulu.', 'error');
  }
}

function openSwapGps() {
  try {
    prepareSwapTestProfile();
    window.location.href = 'map-view.html';
  } catch (err) {
    showToast(err.message || 'Lengkapi link GAS swap test terlebih dahulu.', 'error');
  }
}

function getAttendanceHiddenStorageKey(courseId, sessionId) {
  return ATTENDANCE_HIDDEN_PREFIX + ':' + (courseId || '-') + ':' + (sessionId || '-');
}

function getHiddenAttendanceIds(courseId = activeCourseId, sessionId = activeSessionId) {
  try {
    const raw = localStorage.getItem(getAttendanceHiddenStorageKey(courseId, sessionId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (err) {
    console.warn('Hidden attendance parse error:', err.message);
    return [];
  }
}

function saveHiddenAttendanceIds(ids, courseId = activeCourseId, sessionId = activeSessionId) {
  localStorage.setItem(
    getAttendanceHiddenStorageKey(courseId, sessionId),
    JSON.stringify(Array.from(new Set(ids.map(String))))
  );
}

function hideAllAttendanceItems() {
  const idsToHide = latestVisibleAttendanceRows
    .map((row) => (row && typeof row === 'object' ? String(row.presence_id || '') : ''))
    .filter(Boolean);

  if (idsToHide.length === 0) {
    showToast('Belum ada data absensi.', 'info');
    return;
  }

  const hiddenIds = getHiddenAttendanceIds();
  saveHiddenAttendanceIds(hiddenIds.concat(idsToHide));
  fetchAttendance();
  showToast('Daftar absensi dibersihkan.', 'info');
}


// ═══════════════════════════════════════════════
//  DOSEN: GENERATE QR + AUTO-REFRESH (30s)
// ═══════════════════════════════════════════════
function togglePresence() {
  isPresenceRunning = !isPresenceRunning;
  const btn = document.getElementById('btnTogglePresence');
  const courseSelect = document.getElementById('courseId');
  const sessionSelect = document.getElementById('sessionId');

  if (isPresenceRunning) {
    activeCourseId = courseSelect.value.trim();
    activeSessionId = sessionSelect.value.trim();

    if (!activeCourseId || !activeSessionId) {
      showToast('Pilih Mata Kuliah dan Sesi terlebih dahulu!', 'error');
      isPresenceRunning = false;
      return;
    }

    btn.textContent = 'Hentikan Presensi';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-danger');
    courseSelect.disabled = true;
    sessionSelect.disabled = true;

    generateQR();
    startPolling();
  } else {
    stopPresenceSession();
  }
}

function stopPresenceSession() {
  isPresenceRunning = false;
  const btn = document.getElementById('btnTogglePresence');
  const courseSelect = document.getElementById('courseId');
  const sessionSelect = document.getElementById('sessionId');

  if (btn) {
    btn.textContent = 'Mulai Presensi';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
  }
  if (courseSelect) courseSelect.disabled = false;
  if (sessionSelect) sessionSelect.disabled = false;

  if (qrTimerInterval) clearInterval(qrTimerInterval);
  if (pollingInterval) clearInterval(pollingInterval);

  const qrResult = document.getElementById('qrResult');
  if (qrResult) qrResult.style.display = 'none';
}

function shouldRetryGenerateQr(err) {
  const message = String(err && err.message ? err.message : '');
  return !/Gagal menghubungi backend GAS|URL deployment Web App GAS|script\.googleusercontent|\/exec atau \/dev/i.test(message);
}

async function generateQR() {
  if (!isPresenceRunning) return;

  const statusEl = document.getElementById('qrExpiry');
  if (statusEl) statusEl.textContent = 'Membuat QR baru...';

  try {
    const result = await apiGenerateQrToken({
      course_id: activeCourseId,
      session_id: activeSessionId,
    });

    if (!isPresenceRunning) return; // Stopped while loading

    // Render QR Code — backend returns qr_token only (not URL)
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';

    new QRCode(qrContainer, {
    text: JSON.stringify({
      qr_token: result.qr_token,
      course_id: activeCourseId,
      session_id: activeSessionId,
    }),
      width: 200,
      height: 200,
      colorDark: '#1a1d27',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H,
    });

    document.getElementById('qrTokenText').textContent = result.qr_token;
    document.getElementById('qrResult').style.display = 'block';

    startTimer();
    showToast('QR Token berhasil di-generate!', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    if (isPresenceRunning && shouldRetryGenerateQr(err)) {
      // Retry in 3 seconds on error
      setTimeout(() => generateQR(), 3000);
    }
  }
}

// ─── TIMER (30 second countdown + auto-refresh) ───
function startTimer() {
  if (qrTimerInterval) clearInterval(qrTimerInterval);
  let timeLeft = QR_REFRESH_SECONDS;
  const expiryEl = document.getElementById('qrExpiry');
  const fillEl = document.getElementById('timerFill');

  fillEl.style.width = '100%';

  qrTimerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(qrTimerInterval);
      generateQR(); // Auto-refresh!
      return;
    }
    expiryEl.textContent = 'QR berganti dalam ' + timeLeft + ' detik';
    expiryEl.style.color = timeLeft < 10 ? 'var(--danger)' : 'var(--warn)';
    fillEl.style.width = (timeLeft / QR_REFRESH_SECONDS * 100) + '%';
  }, 1000);
}

// ─── COPY TOKEN ───
function copyToken() {
  const txt = document.getElementById('qrTokenText').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(txt).then(() => showToast('Token disalin!', 'success'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Token disalin!', 'success');
  }
}

// ─── REAL-TIME POLLING (Attendance List) ───
function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  fetchAttendance();
  pollingInterval = setInterval(() => {
    if (isPresenceRunning) fetchAttendance();
  }, POLLING_INTERVAL_MS);
}

async function fetchAttendance() {
  try {
    const data = await apiGetSessionPresenceData(activeCourseId, activeSessionId);
    const countEl = document.getElementById('attendanceCount');
    const bodyEl = document.getElementById('attendanceBody');
    const hideBtn = document.getElementById('btnHideAttendance');

    if (!bodyEl) return;

    // data bisa berupa { count, students: [...] } atau array of user_ids
    const students = Array.isArray(data.students || data) ? (data.students || data) : [];
    const totalCount = data.count !== undefined ? data.count : students.length;
    const hiddenIds = new Set(getHiddenAttendanceIds());
    const visibleStudents = students.filter((student) => {
      if (!student || typeof student !== 'object') return true;
      return !hiddenIds.has(String(student.presence_id || ''));
    });
    latestVisibleAttendanceRows = visibleStudents;

    if (hideBtn) {
      hideBtn.disabled = visibleStudents.length === 0;
    }

    if (countEl) {
      countEl.innerHTML = '<strong>' + visibleStudents.length + '</strong> mahasiswa hadir';
    }

    if (totalCount === 0 || visibleStudents.length === 0) {
      bodyEl.innerHTML = '<tr><td colspan="3" class="empty-msg">Belum ada mahasiswa yang check-in.</td></tr>';
    } else {
      bodyEl.innerHTML = visibleStudents.map((s, idx) => {
        const userId = typeof s === 'string' ? s : s.user_id;
        const ts = (typeof s === 'object' && s.ts)
          ? new Date(s.ts).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' })
          : '—';
        return '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><strong>' + esc(userId) + '</strong></td>' +
          '<td>' + ts + '</td>' +
        '</tr>';
      }).join('');
    }
  } catch (err) {
    console.warn('Attendance fetch error:', err.message);
  }
}

// Alias for manual refresh button
function fetchAttendanceList() {
  fetchAttendance();
}


// ═══════════════════════════════════════════════
//  MAHASISWA: SCANNER
// ═══════════════════════════════════════════════
function startScanner() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('camNotice').style.display = 'block';
    showToast('Kamera live tidak tersedia. Gunakan tombol "Foto QR".', 'error');
    return;
  }

  showToast('Meminta izin kamera...', 'info');

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(function (stream) {
      stream.getTracks().forEach(t => t.stop());
      const container = document.getElementById('scanner-box');
      container.innerHTML = '<div id="qr-reader" style="width:100%"></div>';

      html5QrScanner = new Html5Qrcode('qr-reader');
      html5QrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        function (decodedText) { handleScanResult(decodedText); stopScanner(); },
        function () {}
      ).then(function () {
        document.getElementById('camNotice').style.display = 'none';
        document.getElementById('btnStartScan').style.display = 'none';
        document.getElementById('btnStopScan').style.display = 'inline-flex';
        showToast('Kamera aktif! Arahkan ke QR Code.', 'success');
      }).catch(function () {
        document.getElementById('camNotice').style.display = 'block';
        container.innerHTML = '';
        showToast('Gagal memulai scanner. Gunakan "Foto QR".', 'error');
      });
    })
    .catch(function () {
      document.getElementById('camNotice').style.display = 'block';
      showToast('Kamera live diblokir. Gunakan tombol "Foto QR".', 'error');
    });
}

// ─── SCAN FROM FILE ───
function scanFromFile(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const statusEl = document.getElementById('scanFileStatus');
  statusEl.textContent = 'Memindai QR dari foto...';

  Html5Qrcode.scanFile(file, true)
    .then(function (decodedText) {
      handleScanResult(decodedText);
      statusEl.textContent = 'QR berhasil dipindai!';
      statusEl.style.color = 'var(--success)';
    })
    .catch(function () {
      statusEl.textContent = 'QR tidak terdeteksi. Coba foto lebih jelas.';
      statusEl.style.color = 'var(--danger)';
      showToast('QR tidak terdeteksi dari foto. Pastikan foto jelas.', 'error');
    });
  input.value = '';
}

// ─── HANDLE SCAN RESULT ───
function parseScannedQrPayload(decodedText) {
  const raw = String(decodedText || '').trim();
  if (!raw) {
    return { token: '', courseId: '', sessionId: '' };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const token = String(parsed.qr_token || parsed.token || parsed.t || '').trim();
      if (token) {
        return {
          token,
          courseId: String(parsed.course_id || parsed.c || '').trim(),
          sessionId: String(parsed.session_id || parsed.s || '').trim(),
        };
      }
    }
  } catch (e) {
    // ignore; not a raw JSON QR payload
  }

  try {
    const url = new URL(raw);
    const token = String(url.searchParams.get('token') || url.searchParams.get('qr_token') || '').trim();
    if (token) {
      return {
        token,
        courseId: String(url.searchParams.get('course_id') || '').trim(),
        sessionId: String(url.searchParams.get('session_id') || '').trim(),
      };
    }
  } catch (e) {
    // ignore; not a URL QR payload
  }

  return { token: raw, courseId: '', sessionId: '' };
}

function applyScannedQrPayload(payload) {
  const token = String(payload && payload.token ? payload.token : '').trim();
  const courseId = String(payload && payload.courseId ? payload.courseId : '').trim();
  const sessionId = String(payload && payload.sessionId ? payload.sessionId : '').trim();
  const manualTokenEl = document.getElementById('manualToken');

  scannedCourseId = courseId;
  scannedSessionId = sessionId;

  if (manualTokenEl) manualTokenEl.value = token;
}

function handleScanResult(decodedText) {
  applyScannedQrPayload(parseScannedQrPayload(decodedText));
  showToast('QR berhasil dipindai!', 'success');
}

function stopScanner() {
  if (html5QrScanner) {
    html5QrScanner.stop().then(() => { html5QrScanner.clear(); html5QrScanner = null; }).catch(() => {});
  }
  document.getElementById('scanner-box').innerHTML = '';
  document.getElementById('btnStartScan').style.display = 'inline-flex';
  document.getElementById('btnStopScan').style.display = 'none';
}


// ═══════════════════════════════════════════════
//  MAHASISWA: CHECK-IN (One-shot GPS + Accel)
// ═══════════════════════════════════════════════

// Helper: ambil 3 detik data accelerometer lalu berhenti
function captureAccelOnce() {
  return new Promise((resolve) => {
    if (!window.DeviceMotionEvent) { resolve([]); return; }

    const samples = [];
    function handler(event) {
      const a = event.accelerationIncludingGravity || event.acceleration;
      if (!a) return;
      samples.push({
        x: +(a.x || 0).toFixed(2),
        y: +(a.y || 0).toFixed(2),
        z: +(a.z || 0).toFixed(2),
        ts: new Date().toISOString(),
      });
    }

    function startListening() {
      window.addEventListener('devicemotion', handler);
      setTimeout(() => {
        window.removeEventListener('devicemotion', handler);
        resolve(samples);
      }, 3000); // 3 detik untuk menangkap data
    }

    // iOS 13+ permission
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(state => {
          if (state === 'granted') { startListening(); }
          else { resolve([]); }
        })
        .catch(() => resolve([]));
    } else {
      startListening();
    }
  });
}

async function doCheckin() {
  const userId = document.getElementById('userId').value.trim();
  const scannedPayload = parseScannedQrPayload(document.getElementById('manualToken').value.trim());
  const token = scannedPayload.token;
  const courseId = scannedCourseId || scannedPayload.courseId;
  const sessionId = scannedSessionId || scannedPayload.sessionId;

  if (!userId) { showToast('User ID / NIM wajib diisi!', 'error'); return; }
  if (!token) { showToast('Scan QR terlebih dahulu!', 'error'); return; }

  setLoading('btnCheckin', true);

  try {
    const accelPromise = captureAccelOnce();
    const gpsPromise = new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });

    const result = await apiCheckinPresence({
      qr_token: token,
      user_id: userId,
      device_id: getDeviceId(),
      course_id: courseId,
      session_id: sessionId,
    });

    // TAMBAH INI
    console.log('=== DEBUG CHECKIN ===', JSON.stringify(result, null, 2));

    // 3. Tunggu sensor selesai (GPS + Accel sudah jalan dari tadi)
    const [gpsData, accelSamples] = await Promise.all([gpsPromise, accelPromise]);

    // 4. Kirim data sensor ke backend (fire-and-forget, tidak blokir UI)
    if (gpsData) {
      apiLogGPS({
        device_id: getDeviceId(),
        lat: gpsData.latitude,
        lng: gpsData.longitude,
        accuracy: gpsData.accuracy || '',
        altitude: gpsData.altitude || '',
      }).catch(e => console.warn('GPS log error:', e));
    }
    if (accelSamples.length > 0) {
      apiBatchAccel({
        device_id: getDeviceId(),
        data: accelSamples,
      }).catch(e => console.warn('Accel log error:', e));
    }

    // 4. Tampilkan hasil check-in
    const el = document.getElementById('checkinResult');
    el.style.display = 'block';

    if (result.status === 'already_checked_in') {
      el.innerHTML =
        '<div class="result-card result-warn">' +
          '<div class="big-check icon-warn"></div>' +
          '<div class="title" style="color:var(--warn)">Sudah Check-in</div>' +
          '<div class="meta">Anda sudah tercatat di sesi ini.</div>' +
          '<div class="meta">ID: ' + esc(result.presence_id) + '</div>' +
        '</div>';
      showToast('Anda sudah check-in sebelumnya.', 'info');
    } else {
      el.innerHTML =
        '<div class="result-card">' +
          '<div class="big-check icon-check"></div>' +
          '<div class="title">Check-in Berhasil!</div>' +
          '<div class="meta">ID: ' + esc(result.presence_id) + '</div>' +
          '<div class="meta">Status: ' + esc(result.status) + '</div>' +
        '</div>';
      showToast('Check-in berhasil!', 'success');
    }
  } catch (err) {
    const el = document.getElementById('checkinResult');
    el.style.display = 'block';
    let errMsg = err.message;
    if (errMsg === 'token_expired') errMsg = 'Token sudah kedaluwarsa. Minta QR baru dari Dosen.';
    if (errMsg === 'token_invalid') errMsg = 'Token tidak valid. Pastikan scan QR yang benar.';
    el.innerHTML =
      '<div class="result-card result-error">' +
        '<div class="big-check icon-error"></div>' +
        '<div class="title" style="color:var(--danger)">Check-in Gagal</div>' +
        '<div class="meta">' + esc(errMsg) + '</div>' +
      '</div>';
    showToast('Error: ' + errMsg, 'error');
  } finally {
    setLoading('btnCheckin', false);
  }
}


// ═══════════════════════════════════════════════
//  ACCELEROMETER TELEMETRY (Continuous Batch)
// ═══════════════════════════════════════════════

let accelTelemetryActive = false;
let accelSampleBuffer = [];
let accelBatchInterval = null;
let accelLastSampleTime = 0;
let accelChart = null;
const ACCEL_BATCH_MS = 3000; // 3 detik
const ACCEL_THROTTLE_MS = 200; // ambil sampel tiap 200ms
const ACCEL_CHART_MAX = 60; // max data points on chart
const MAX_LOG_ITEMS = 20;

function toggleAccelTelemetry() {
  if (accelTelemetryActive) {
    stopAccelTelemetry();
  } else {
    startAccelTelemetry();
  }
}

function startAccelTelemetry() {
  const deviceId = document.getElementById('accelDeviceId').value.trim();
  if (!deviceId) {
    showToast('Device ID wajib diisi!', 'error');
    return;
  }

  if (!window.DeviceMotionEvent) {
    showToast('Accelerometer tidak didukung di perangkat ini.', 'error');
    addAccelLog('❌ Sensor tidak didukung', 'error');
    return;
  }

  // iOS 13+ permission
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          activateAccelSensor(deviceId);
        } else {
          showToast('Izin sensor ditolak.', 'error');
          addAccelLog('❌ Izin sensor ditolak oleh user', 'error');
        }
      })
      .catch(err => {
        showToast('Error meminta izin: ' + err.message, 'error');
        addAccelLog('❌ Error permission: ' + err.message, 'error');
      });
  } else {
    activateAccelSensor(deviceId);
  }
}

function activateAccelSensor(deviceId) {
  accelTelemetryActive = true;
  accelSampleBuffer = [];
  accelLastSampleTime = 0;

  // Toggle UI
  document.getElementById('accelToggle').classList.add('active');
  document.getElementById('accelSensorStatus').textContent = 'Sensor aktif — mengumpulkan data...';
  document.getElementById('accelSensorStatus').style.color = 'var(--success)';
  document.getElementById('accelDeviceId').disabled = true;

  // Init chart
  initAccelChart();

  addAccelLog('✅ Sensor dimulai untuk device: ' + deviceId, 'success');

  // Listen to devicemotion
  window.addEventListener('devicemotion', handleAccelMotion);

  // Batch send interval every 3 seconds
  accelBatchInterval = setInterval(() => {
    sendAccelBatch(deviceId);
  }, ACCEL_BATCH_MS);
}

function handleAccelMotion(event) {
  if (!accelTelemetryActive) return;

  const a = event.accelerationIncludingGravity || event.acceleration;
  if (!a) return;

  const x = +(a.x || 0).toFixed(2);
  const y = +(a.y || 0).toFixed(2);
  const z = +(a.z || 0).toFixed(2);

  // Update live display (always, for smooth UI)
  document.getElementById('accelX').textContent = x;
  document.getElementById('accelY').textContent = y;
  document.getElementById('accelZ').textContent = z;

  // Throttle: ambil sampel tiap 200ms
  const now = Date.now();
  if (now - accelLastSampleTime < ACCEL_THROTTLE_MS) return;
  accelLastSampleTime = now;

  // Push to buffer
  accelSampleBuffer.push({
    t: new Date().toISOString(),
    x: x, y: y, z: z,
  });

  // Update chart
  updateAccelChart(x, y, z);
}

async function sendAccelBatch(deviceId) {
  if (accelSampleBuffer.length === 0) {
    addAccelLog('⏳ Tidak ada sample untuk dikirim', 'info');
    return;
  }

  const samples = [...accelSampleBuffer];
  accelSampleBuffer = [];

  const payload = {
    device_id: deviceId,
    ts: new Date().toISOString(),
    samples: samples,
  };

  try {
    const result = await apiPostAccelTelemetry(payload);
    const count = result.accepted || samples.length;
    document.getElementById('accelBatchInfo').innerHTML =
      'Batch terakhir: <strong>' + count + ' samples</strong> — ' +
      new Date().toLocaleTimeString('id-ID');
    addAccelLog('📤 Batch terkirim: ' + count + ' samples', 'success');
  } catch (err) {
    showToast('Gagal kirim batch: ' + err.message, 'error');
    addAccelLog('❌ Gagal kirim: ' + err.message, 'error');
    // Kembalikan samples yang gagal ke buffer
    accelSampleBuffer = samples.concat(accelSampleBuffer);
  }
}

function stopAccelTelemetry() {
  accelTelemetryActive = false;
  window.removeEventListener('devicemotion', handleAccelMotion);
  if (accelBatchInterval) {
    clearInterval(accelBatchInterval);
    accelBatchInterval = null;
  }

  // Kirim sisa buffer terakhir jika ada
  const deviceId = document.getElementById('accelDeviceId').value.trim();
  if (accelSampleBuffer.length > 0 && deviceId) {
    sendAccelBatch(deviceId);
  }

  // Destroy chart
  if (accelChart) {
    accelChart.destroy();
    accelChart = null;
  }

  // Toggle UI
  document.getElementById('accelToggle').classList.remove('active');
  document.getElementById('accelSensorStatus').textContent = 'Sensor dihentikan';
  document.getElementById('accelSensorStatus').style.color = 'var(--muted)';
  document.getElementById('accelDeviceId').disabled = false;

  addAccelLog('⏹ Sensor dihentikan', 'info');
}

// ─── GRAFIK ACCELEROMETER (Chart.js) ───
function initAccelChart() {
  const ctx = document.getElementById('accelChart');
  if (!ctx) return;
  if (accelChart) accelChart.destroy();

  accelChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'X (m/s²)', borderColor: '#ef4444', backgroundColor: 'transparent', data: [], borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'Y (m/s²)', borderColor: '#22c55e', backgroundColor: 'transparent', data: [], borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'Z (m/s²)', borderColor: '#3b82f6', backgroundColor: 'transparent', data: [], borderWidth: 2, pointRadius: 0, tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } },
      scales: {
        x: { display: false },
        y: { display: true, beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' } }
      }
    }
  });
}

function updateAccelChart(x, y, z) {
  if (!accelChart) return;
  const data = accelChart.data;

  // Add new data
  data.labels.push('');
  data.datasets[0].data.push(x);
  data.datasets[1].data.push(y);
  data.datasets[2].data.push(z);

  // Keep array size to ACCEL_CHART_MAX items max
  if (data.labels.length > ACCEL_CHART_MAX) {
    data.labels.shift();
    data.datasets[0].data.shift();
    data.datasets[1].data.shift();
    data.datasets[2].data.shift();
  }

  accelChart.update();
}

// Alias untuk dipanggil dari showView saat pindah halaman
function stopAccel() {
  if (accelTelemetryActive) stopAccelTelemetry();
}

// ═══════════════════════════════════════════════
//  MODUL 3: GPS & RUTE PETA (LEAFLET + OSRM)
// ═══════════════════════════════════════════════
let mapGps = null;
let myMarkerGps = null;
let routeLayerGps = null;
let otherUsersLayerGps = null;
let historyLayerGps = null; // Tambahan untuk garis riwayat putus-putus
let myLocGps = null;
let isSharingGps = false;
let shareGpsInterval = null;
let gpsWatchId = null;
let destinationPin = null;
let gpsShareWarningShown = false;
let gpsShareStartedAt = null;

const GPS_SHARE_DEPLOYMENT_ERROR =
  "Live Loc gagal: endpoint GPS backend belum aktif. Deploy ulang backend-gas.";

function initMapGps() {
  // Jika map sudah pernah dirender, cukup update ukurannya agar tidak nge-bug (hitam)
  if (mapGps) {
    setTimeout(() => mapGps.invalidateSize(), 100);
    startGpsTracking();
    return;
  }

  // Render awal map
  mapGps = L.map("map").setView([-7.2575, 112.7521], 13);
  otherUsersLayerGps = L.layerGroup().addTo(mapGps);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(mapGps);

  // Fitur Klik Peta untuk Buat Rute
  mapGps.on("click", async (e) => {
    if (!myLocGps) {
      showToast("Tunggu sampai lokasimu terdeteksi dulu ya!", "warn");
      return;
    }

    if (destinationPin) mapGps.removeLayer(destinationPin);
    if (routeLayerGps) mapGps.removeLayer(routeLayerGps);

    destinationPin = L.marker([e.latlng.lat, e.latlng.lng]).addTo(mapGps).bindPopup("Menghitung rute...").openPopup();

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${myLocGps.lng},${myLocGps.lat};${e.latlng.lng},${e.latlng.lat}?overview=full&geometries=geojson`;

    try {
      const res = await fetch(osrmUrl);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        routeLayerGps = L.polyline(routeCoords, { color: "#4361ee", weight: 5 }).addTo(mapGps);
        destinationPin.setPopupContent(`Jarak: ${(data.routes[0].distance / 1000).toFixed(2)} km`).openPopup();
      }
    } catch (err) {
      destinationPin.setPopupContent("Gagal menghitung rute.");
    }
  });

  setTimeout(() => mapGps.invalidateSize(), 100);
  startGpsTracking();
}

function startGpsTracking() {
  if ("geolocation" in navigator) {
    if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
    
    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        myLocGps = { lat: latitude, lng: longitude };
        document.getElementById('gpsStatus').innerText = `Akurasi GPS: ${Math.round(accuracy)} meter`;

        if (!myMarkerGps) {
          myMarkerGps = L.marker([latitude, longitude]).addTo(mapGps).bindPopup("Kamu di sini!").openPopup();
          mapGps.setView([latitude, longitude], 15);
        } else {
          myMarkerGps.setLatLng([latitude, longitude]);
        }
      },
      (err) => document.getElementById('gpsStatus').innerText = "Izinkan akses lokasi GPS di browser!",
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  }
}

// Berhentikan pelacakan saat pindah ke menu lain
function stopGPS() {
  if (gpsWatchId) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (isSharingGps) {
    toggleShareGps(); // Matikan fitur share secara otomatis jika keluar dari halaman
  }
}

function parseGpsCoord(value) {
  return parseFloat(String(value).replace(',', '.'));
}

function setGpsPanelStatus(message) {
  const statusEl = document.getElementById('gpsStatus');
  if (statusEl) statusEl.innerText = message;
}

function handleGpsShareError(error) {
  const rawMessage = String(error && error.message ? error.message : error);
  const message =
    rawMessage.includes('telemetry/gps/latest') || rawMessage.includes('telemetry/gps/history')
      ? GPS_SHARE_DEPLOYMENT_ERROR
      : "Gagal sinkron lokasi live.";

  setGpsPanelStatus(message);
  if (!gpsShareWarningShown) {
    showToast(message, "error");
    gpsShareWarningShown = true;
  }
  console.warn("GPS sync error:", error);
}

async function syncSharedGps() {
  if (!myLocGps) return;

  await apiLogGPS({
    device_id: getDeviceId(),
    lat: myLocGps.lat,
    lng: myLocGps.lng,
    accuracy: 10,
    mode: "live_loc"
  });

  const data = await apiGetGpsLiveUsers();
  otherUsersLayerGps.clearLayers();

  Object.keys(data).forEach(key => {
    if (key !== getDeviceId()) {
      const friend = data[key];
      const fLat = parseGpsCoord(friend.lat);
      const fLng = parseGpsCoord(friend.lng);

      if (!isNaN(fLat) && !isNaN(fLng)) {
        L.marker([fLat, fLng]).addTo(otherUsersLayerGps)
          .bindPopup(`ID Teman: <b>${key}</b><br>â° ${new Date(friend.ts).toLocaleTimeString('id-ID')}`);
      }
    }
  });

  const history = await apiGetGpsHistory(getDeviceId(), 200, gpsShareStartedAt);
  if (history && history.items && history.items.length > 1) {
    if (historyLayerGps) mapGps.removeLayer(historyLayerGps);

    const historyCoords = history.items.map(item => [
      parseGpsCoord(item.lat),
      parseGpsCoord(item.lng)
    ]);

    historyLayerGps = L.polyline(historyCoords, {
      color: "#ff4757",
      weight: 4,
      dashArray: "10, 10",
      opacity: 0.8
    }).addTo(mapGps);
  } else if (historyLayerGps) {
    mapGps.removeLayer(historyLayerGps);
    historyLayerGps = null;
  }
}

async function toggleShareGps() {
  const btn = document.getElementById('btnShareGps');
  isSharingGps = !isSharingGps;

  if (isSharingGps) {
    btn.innerText = "🔴 Berhenti Share Live Loc";
    btn.classList.replace("btn-primary", "btn-danger");
    gpsShareWarningShown = false;
    gpsShareStartedAt = new Date().toISOString();
    showToast("Live Location dinyalakan", "success");

    try {
      await syncSharedGps();
    } catch (error) {
      handleGpsShareError(error);
    }

    shareGpsInterval = setInterval(async () => {
      if (!myLocGps) return;
      try {
        // 1. Post lokasi kita sendiri menggunakan apiLogGPS bawaan
          await apiLogGPS({
              device_id: getDeviceId(),
              lat: myLocGps.lat,
              lng: myLocGps.lng,
              accuracy: 10,
              mode: "live_loc"
          });

      // 2. Tarik lokasi semua teman menggunakan apiGet (Bawaan api.js yang anti-CORS)
       const data = await apiGetGpsLiveUsers();
        
        if (data) {
          otherUsersLayerGps.clearLayers(); // Bersihkan marker lama
          Object.keys(data).forEach(key => {
            if (key !== getDeviceId()) { // Pastikan bukan diri sendiri
              const friend = data[key];
              // Ubah ke format angka (Float)
              const fLat = parseGpsCoord(friend.lat);
              const fLng = parseGpsCoord(friend.lng);
              
              if (!isNaN(fLat) && !isNaN(fLng)) {
                L.marker([fLat, fLng]).addTo(otherUsersLayerGps)
                 .bindPopup(`ID Teman: <b>${key}</b><br>⏰ ${new Date(friend.ts).toLocaleTimeString('id-ID')}`);
              }
            }
          });
        }

        // 3. Tarik Riwayat Perjalanan & Gambar Garis Putus-putus
        try {
            const history = await apiGetGpsHistory(getDeviceId(), 200, gpsShareStartedAt);
          if (history && history.items && history.items.length > 1) {
            // Hapus garis riwayat yang lama sebelum menggambar yang baru
            if (historyLayerGps) mapGps.removeLayer(historyLayerGps);
            
            // Ambil titik-titiknya
              const historyCoords = history.items.map(item => [parseGpsCoord(item.lat), parseGpsCoord(item.lng)]);
            
            // Gambar rute dengan garis PUTUS-PUTUS (menggunakan dashArray)
            historyLayerGps = L.polyline(historyCoords, {
              color: "#ff4757", // Warna merah
              weight: 4,
              dashArray: "10, 10", // 👈 Efek putus-putus
              opacity: 0.8
            }).addTo(mapGps);
          } else if (historyLayerGps) {
            mapGps.removeLayer(historyLayerGps);
            historyLayerGps = null;
          }
        } catch (err) { console.log("Gagal memuat riwayat perjalanan"); }

        } catch (e) { handleGpsShareError(e); }
    }, 5000);
  } else {
    btn.innerText = "🟢 Mulai Share Live Loc";
    gpsShareStartedAt = null;
    btn.classList.replace("btn-danger", "btn-primary");
    if (shareGpsInterval) clearInterval(shareGpsInterval);
    apiStopLiveGps(getDeviceId(), new Date().toISOString()).catch(err => console.warn("Gagal mematikan status live loc:", err));
    if (historyLayerGps) {
      mapGps.removeLayer(historyLayerGps);
      historyLayerGps = null;
    }
  }
}

// ─── ADMIN VIEWER ───
let adminRefreshInterval = null;
let adminSelectedDevice = '';
let adminChart = null;

async function loadAdminDevices() {
  const select = document.getElementById('adminDeviceSelect');
  try {
    const data = await apiGetAccelDevices();
    // Clear existing options except first
    select.innerHTML = '<option value="">-- Pilih Device --</option>';
    if (data.devices && data.devices.length > 0) {
      data.devices.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        select.appendChild(opt);
      });
      // Re-select previously selected device if still exists
      if (adminSelectedDevice && data.devices.includes(adminSelectedDevice)) {
        select.value = adminSelectedDevice;
      }
    }
  } catch (err) {
    showToast('Gagal memuat daftar device: ' + err.message, 'error');
  }
}

function onAdminDeviceChange() {
  adminSelectedDevice = document.getElementById('adminDeviceSelect').value;
  if (!adminSelectedDevice) {
    stopAdminRefresh();
    document.getElementById('adminStatus').textContent = 'Pilih device terlebih dahulu';
    document.getElementById('adminStatusDot').textContent = '⏳';
    document.getElementById('adminX').textContent = '—';
    document.getElementById('adminY').textContent = '—';
    document.getElementById('adminZ').textContent = '—';
    document.getElementById('adminTimestamp').textContent = '—';
    destroyAdminAccelChart();
    return;
  }
  // Init chart target
  initAdminAccelChart();

  // Start auto-refresh
  loadAdminLatest();
  stopAdminRefresh();
  adminRefreshInterval = setInterval(loadAdminLatest, 5000);
}

async function loadAdminLatest() {
  if (!adminSelectedDevice) return;
  document.getElementById('adminStatusDot').textContent = '🔄';
  document.getElementById('adminStatus').textContent = 'Mengambil data...';
  try {
    const data = await apiGetAccelLatest(adminSelectedDevice);
    document.getElementById('adminX').textContent = parseFloat(data.x).toFixed(2);
    document.getElementById('adminY').textContent = parseFloat(data.y).toFixed(2);
    document.getElementById('adminZ').textContent = parseFloat(data.z).toFixed(2);
    document.getElementById('adminTimestamp').innerHTML =
      'Last update: <strong>' + new Date(data.t).toLocaleTimeString() + '</strong>';
    document.getElementById('adminStatusDot').textContent = '🟢';
    document.getElementById('adminStatus').textContent = 'Online — ' + adminSelectedDevice;
    document.getElementById('adminStatus').style.color = 'var(--success)';

    // Update chart
    updateAdminAccelChart(data.x, data.y, data.z);
  } catch (err) {
    document.getElementById('adminStatusDot').textContent = '🔴';
    document.getElementById('adminStatus').textContent = 'Offline / tidak ditemukan';
    document.getElementById('adminStatus').style.color = 'var(--danger)';
  }
}

function stopAdminRefresh() {
  if (adminRefreshInterval) {
    clearInterval(adminRefreshInterval);
    adminRefreshInterval = null;
  }
}

function initAdminAccelChart() {
  const ctx = document.getElementById('adminAccelChart');
  if (!ctx) return;
  if (adminChart) adminChart.destroy();

  adminChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'X (m/s²)', borderColor: '#ef4444', backgroundColor: 'transparent', data: [], borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'Y (m/s²)', borderColor: '#22c55e', backgroundColor: 'transparent', data: [], borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'Z (m/s²)', borderColor: '#3b82f6', backgroundColor: 'transparent', data: [], borderWidth: 2, pointRadius: 0, tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } },
      scales: {
        x: { display: false },
        y: { display: true, beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' } }
      }
    }
  });
}

function updateAdminAccelChart(x, y, z) {
  if (!adminChart) return;
  const data = adminChart.data;

  // Add new data
  data.labels.push('');
  data.datasets[0].data.push(x);
  data.datasets[1].data.push(y);
  data.datasets[2].data.push(z);

  // Keep array size to ACCEL_CHART_MAX items max
  if (data.labels.length > ACCEL_CHART_MAX) {
    data.labels.shift();
    data.datasets[0].data.shift();
    data.datasets[1].data.shift();
    data.datasets[2].data.shift();
  }

  adminChart.update();
}

function destroyAdminAccelChart() {
  if (adminChart) {
    adminChart.destroy();
    adminChart = null;
  }
}

function addAccelLog(message, type) {
  const list = document.getElementById('accelLogList');
  if (!list) return;

  // Hapus empty message
  const emptyMsg = list.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  const item = document.createElement('div');
  item.className = 'accel-log-item ' + (type || 'info');
  const time = new Date().toLocaleTimeString('id-ID');
  item.innerHTML = '<span class="log-time">' + time + '</span> ' + esc(message);
  list.prepend(item);

  // Batasi jumlah log
  while (list.children.length > MAX_LOG_ITEMS) {
    list.removeChild(list.lastChild);
  }
}


// ═══════════════════════════════════════════════
//  PWA: SERVICE WORKER & INSTALL
// ═══════════════════════════════════════════════
let deferredPrompt = null;

function initPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('SW registered', reg.scope))
      .catch(err => console.warn('SW registration failed', err));
  }

  // Listen for install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  // Detect if already installed
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBanner();
    showToast('Aplikasi berhasil diinstall!', 'success');
  });

  // Offline / Online detection
  window.addEventListener('online', () => {
    document.getElementById('offlineBar').classList.remove('visible');
    showToast('Koneksi kembali!', 'success');
  });
  window.addEventListener('offline', () => {
    document.getElementById('offlineBar').classList.add('visible');
  });
}

function showInstallBanner() {
  const banner = document.getElementById('installBanner');
  if (banner) banner.classList.remove('hidden');
}

function hideInstallBanner() {
  const banner = document.getElementById('installBanner');
  if (banner) banner.classList.add('hidden');
}

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    showToast('Menginstall aplikasi...', 'info');
  }
  deferredPrompt = null;
  hideInstallBanner();
}


// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initPWA();

  // Auto-fill dari URL params (jika buka dari QR)
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    showView('mahasiswa');
    document.getElementById('manualToken').value = token;
    showToast('Token dari QR berhasil dimuat!', 'success');
  }

  // Show device ID
  const devIdEl = document.getElementById('deviceIdDisplay');
  if (devIdEl) devIdEl.textContent = getDeviceId();
  refreshSwapTestPanel();
});

  // Show device ID
  const devIdEl = document.getElementById('deviceIdDisplay');
  if (devIdEl) devIdEl.textContent = getDeviceId();
  refreshSwapTestPanel();

