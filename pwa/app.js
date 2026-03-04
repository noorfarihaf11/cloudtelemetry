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
  } else {
    btnBack.classList.add('visible');
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
      text: result.qr_token,
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
    if (isPresenceRunning) {
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
    const users = await apiGetSessionPresenceData(activeCourseId, activeSessionId);
    const listEl = document.getElementById('attendanceList');
    const countEl = document.getElementById('attendanceCount');

    if (!listEl) return;
    countEl.textContent = users.length;

    if (users.length === 0) {
      listEl.innerHTML = '<div class="empty-msg">Belum ada mahasiswa yang absen.</div>';
    } else {
      const reversed = [...users].reverse();
      listEl.innerHTML = reversed.map(uid =>
        '<div class="attendance-item"><span class="att-dot"></span>' + esc(uid) + '</div>'
      ).join('');
    }
  } catch (err) {
    // Silently fail on polling errors
    console.warn('Polling error:', err.message);
  }
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
// Backend QR encodes just the token string directly
function handleScanResult(decodedText) {
  try {
    // Try parsing as URL first (backward compat)
    const url = new URL(decodedText);
    const token = url.searchParams.get('token');
    if (token) {
      document.getElementById('manualToken').value = token;
    } else {
      document.getElementById('manualToken').value = decodedText;
    }
  } catch (e) {
    // Not a URL — it's a raw token string (expected case)
    document.getElementById('manualToken').value = decodedText;
  }
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

// Helper: ambil 1 detik data accelerometer lalu berhenti
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

    // iOS 13+ permission
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(state => {
          if (state === 'granted') {
            window.addEventListener('devicemotion', handler);
            setTimeout(() => { window.removeEventListener('devicemotion', handler); resolve(samples); }, 1000);
          } else { resolve([]); }
        })
        .catch(() => resolve([]));
    } else {
      window.addEventListener('devicemotion', handler);
      setTimeout(() => { window.removeEventListener('devicemotion', handler); resolve(samples); }, 1000);
    }
  });
}

async function doCheckin() {
  const userId = document.getElementById('userId').value.trim();
  const token = document.getElementById('manualToken').value.trim();

  if (!userId) { showToast('User ID / NIM wajib diisi!', 'error'); return; }
  if (!token) { showToast('Scan QR terlebih dahulu!', 'error'); return; }

  setLoading('btnCheckin', true);

  try {
    // 1. Check-in ke backend
    const result = await apiCheckinPresence({
      qr_token: token,
      user_id: userId,
      device_id: getDeviceId(),
    });

    // 2. Ambil GPS + Accel secara paralel (one-shot, tidak terus-menerus)
    const [gpsData, accelSamples] = await Promise.all([
      new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      }),
      captureAccelOnce(),
    ]);

    // 3. Kirim data sensor ke backend (fire-and-forget, tidak blokir UI)
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
});
