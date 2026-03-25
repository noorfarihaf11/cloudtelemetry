// --- DEKLARASI VARIABEL ---
let map;
let myMarker;
let myCurrentLoc = null;

// Rute (Garis Lurus)
let isRouteModeActive = false;
let destinationMarker = null;
let routeLayer = null;

// Live Loc & Tracking History
let isLiveLocActive = false;
let isTrackingActive = false;
let syncInterval = null;
let otherUsersLayer = L.layerGroup(); // Layer khusus teman
let historyLayer = null;              // Layer garis putus-putus
let trackingStartedAt = null;         // Timestamp saat tracking mulai

const GPS_DEPLOYMENT_ERROR =
  "Live Loc gagal: endpoint GPS backend belum aktif. Deploy ulang backend-gas.";

// --- FUNGSI MENDAPATKAN DEVICE ID ---
// Agar tidak tertukar dengan user lain di database
function getMyDeviceId() {
  let deviceId = localStorage.getItem('device_id');
  if (!deviceId) {
    deviceId = 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    localStorage.setItem('device_id', deviceId);
  }
  return deviceId;
}

// --- INISIALISASI PETA ---
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([-2.5489, 118.0149], 5);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
  
  otherUsersLayer.addTo(map); // Daftarkan layer teman ke peta

  map.on('click', function(e) {
    if (!isRouteModeActive) return; 
    if (!myCurrentLoc) {
      alert("Tunggu sampai lokasimu terdeteksi dulu ya!");
      return;
    }
    calculateAndDrawRoute(e.latlng);
  });

  startGPS();
}

// --- FUNGSI GPS REAL-TIME ---
function startGPS() {
  if (!navigator.geolocation) {
    document.getElementById('gps-status').innerText = "GPS tidak didukung browser ini.";
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      myCurrentLoc = { lat, lng };

      document.getElementById('gps-status').innerText = "Lokasi: " + getMyDeviceId();
      document.getElementById('gps-dot').classList.add('active');

      if (!myMarker) {
        map.setView([lat, lng], 15);
        myMarker = L.marker([lat, lng]).addTo(map).bindPopup("Kamu di sini!").openPopup();
      } else {
        myMarker.setLatLng([lat, lng]); 
      }
    },
    (error) => document.getElementById('gps-status').innerText = "Nyalakan izin lokasi!",
    { enableHighAccuracy: true, maximumAge: 0 }
  );
}

// --- FITUR 1: BERI PIN & RUTE (OSRM) ---
function toggleRouteMode() {
  const btn = document.getElementById('btn-route');
  isRouteModeActive = !isRouteModeActive;

  if (isRouteModeActive) {
    btn.style.background = '#ffa502'; 
    btn.innerText = "📍 Mode Pin (Aktif)";
  } else {
    btn.style.background = '#1e90ff'; 
    btn.innerText = "📍 Beri Pin Rute";
  }
}

async function calculateAndDrawRoute(destinationLatLng) {
  if (destinationMarker) map.removeLayer(destinationMarker);
  if (routeLayer) map.removeLayer(routeLayer);

  destinationMarker = L.marker(destinationLatLng).addTo(map).bindPopup("Menghitung rute...").openPopup();

  const start = `${myCurrentLoc.lng},${myCurrentLoc.lat}`;
  const end = `${destinationLatLng.lng},${destinationLatLng.lat}`;
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(osrmUrl);
    const data = await response.json();

    if (data.code === "Ok" && data.routes.length > 0) {
      const route = data.routes[0];
      const routeCoords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

      routeLayer = L.polyline(routeCoords, { color: '#4361ee', weight: 6, opacity: 0.8 }).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

      const distanceKm = (route.distance / 1000).toFixed(2);
      destinationMarker.setPopupContent(`<b>Tujuan</b><br>Jarak: ${distanceKm} km`).openPopup();
    } else {
      destinationMarker.setPopupContent("Jalan raya tidak ditemukan.").openPopup();
    }
  } catch (error) {
    destinationMarker.setPopupContent("Gagal mengambil data rute.").openPopup();
  }
}

// --- FITUR 2 & 3: MANAJEMEN SYNC INTERVAL ---
// Fungsi ini mengatur agar data dikirim setiap 5 detik HANYA saat fitur dinyalakan
function manageSyncInterval() {
  if (isLiveLocActive || isTrackingActive) {
    if (!syncInterval) syncInterval = setInterval(syncDataWithBackend, 5000);
    syncDataWithBackend(); // Langsung eksekusi 1x saat tombol ditekan
  } else {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }
}

function setGpsStatusText(message) {
  const statusEl = document.getElementById('gps-status');
  if (statusEl) statusEl.innerText = message;
}

function handleGpsSyncError(error) {
  const message = String(error && error.message ? error.message : error);
  if (message.includes('telemetry/gps/latest') || message.includes('telemetry/gps/history')) {
    setGpsStatusText(GPS_DEPLOYMENT_ERROR);
  }
  console.warn("Gagal menarik data dari GAS:", error);
}

function getGpsSyncMode() {
  const modes = [];
  if (isLiveLocActive) modes.push('live_loc');
  if (isTrackingActive) modes.push('tracking');
  return modes.join(',');
}

async function syncDataWithBackend() {
  if (!myCurrentLoc) return;
  const myId = getMyDeviceId();
  const parseKordinat = (angka) => parseFloat(String(angka).replace(',', '.'));

  // 1. KIRIM DATA (Fire and Forget)
  // Kita hilangkan 'await' dan pisahkan try/catch-nya. 
  // Biarkan proses kirim berjalan di latar belakang tanpa memblokir proses tarik data.
  apiLogGPS({
    device_id: myId,
    lat: myCurrentLoc.lat,
    lng: myCurrentLoc.lng,
    accuracy: 10,
    mode: getGpsSyncMode()
  }).catch(err => console.log("Log GPS jalan, abaikan error bawaan Google:", err));

  // 2. TARIK DATA
  try {
    // --- FITUR LIVE LOC ---
    if (isLiveLocActive) {
      const data = await apiGetGpsLatest();
      if (data) {
        otherUsersLayer.clearLayers(); 
        Object.keys(data).forEach(key => {
          if (key !== myId) {
            const friend = data[key];
            const fLat = parseKordinat(friend.lat);
            const fLng = parseKordinat(friend.lng);
            
            if (!isNaN(fLat) && !isNaN(fLng)) {
              const friendIcon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div style="background-color:#2ed573; width:15px; height:15px; border-radius:50%; border:2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
                iconSize: [15, 15]
              });

              L.marker([fLat, fLng], {
                icon: friendIcon,
                zIndexOffset: 1000 // 👈 Paksa marker teman agar selalu berada DI ATAS marker biru
              }).addTo(otherUsersLayer)
                .bindPopup(`<b>Teman:</b> ${key}<br>⏰ ${new Date(friend.ts).toLocaleTimeString('id-ID')}`);
            }
          }
        });
      }
    }

    // --- FITUR TRACKING ---
    if (isTrackingActive) {
      // 👈 Tambahkan _t: Date.now() untuk membobol sistem Cache bawaan Google
      const history = await apiGetGpsHistory(myId, 200, trackingStartedAt);
      if (history && history.items && history.items.length > 1) {
        if (historyLayer) map.removeLayer(historyLayer);
        
        const historyCoords = history.items.map(item => [
          parseKordinat(item.lat), 
          parseKordinat(item.lng)
        ]);
        
        historyLayer = L.polyline(historyCoords, {
          color: "#ff4757",     
          weight: 4,
          dashArray: "10, 10",  
          opacity: 0.8
        }).addTo(map);
      } else if (historyLayer) {
        map.removeLayer(historyLayer);
        historyLayer = null;
      }
    }
  } catch (error) {
    handleGpsSyncError(error);
  }
}

// --- TOMBOL TOGGLE ---
function toggleLiveLoc() {
  const btn = document.getElementById('btn-live');
  isLiveLocActive = !isLiveLocActive;

  if (isLiveLocActive) {
    btn.style.background = '#ff4757'; 
    btn.innerText = "🔴 Live Loc (Nyala)";
  } else {
    btn.style.background = '#747d8c'; 
    btn.innerText = "📡 Live Loc (Mati)";
    otherUsersLayer.clearLayers(); // Bersihkan peta dari marker teman
  }
  manageSyncInterval();
}

function toggleTracking() {
  const btn = document.getElementById('btn-track');
  isTrackingActive = !isTrackingActive;

  if (isTrackingActive) {
    trackingStartedAt = new Date().toISOString();
    btn.style.background = '#ffa502'; 
    btn.style.color = '#000';
    btn.innerText = "⏹️ Stop Tracking";
  } else {
    trackingStartedAt = null;
    btn.style.background = '#2f3542'; 
    btn.style.color = '#fff';
    btn.innerText = "🗺️ Mulai Tracking";
    if (historyLayer) {
      map.removeLayer(historyLayer); // Bersihkan garis merah
      historyLayer = null;
    }
  }
  manageSyncInterval();
}

window.onload = initMap;
