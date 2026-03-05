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
    btnBack.onclick = function() { showView('role'); };
    stopAccel();
    stopAdminRefresh();
  } else {
    btnBack.onclick = function() { showView('role'); };
  }

  // Auto-load devices when entering admin view
  if (name === 'accel-admin') {
    loadAdminDevices();
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
    const data = await apiGetSessionPresenceData(activeCourseId, activeSessionId);
    const countEl = document.getElementById('attendanceCount');
    const bodyEl = document.getElementById('attendanceBody');

    if (!bodyEl) return;

    // data bisa berupa { count, students: [...] } atau array of user_ids
    const students = data.students || data;
    const count = data.count !== undefined ? data.count : students.length;

    countEl.innerHTML = '<strong>' + count + '</strong> mahasiswa sudah check-in';

    if (count === 0 || students.length === 0) {
      bodyEl.innerHTML = '<tr><td colspan="3" class="empty-msg">Belum ada mahasiswa yang check-in.</td></tr>';
    } else {
      bodyEl.innerHTML = students.map((s, idx) => {
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
  const token = document.getElementById('manualToken').value.trim();

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
    });

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

function stopGPS() {
  // Placeholder — GPS tidak ada continuous mode di sini
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
});
