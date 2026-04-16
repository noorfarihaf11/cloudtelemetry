# ☁️ CloudTelemetry

Sistem **presensi, telemetry, dan GPS tracking** berbasis cloud dengan backend serverless menggunakan Google Apps Script (GAS) dan client Progressive Web App (PWA) Vanilla JS.

> Kelompok 3 · C1

---

## 🏗️ Arsitektur Sistem

```
PWA Client (Frontend - Vanilla JS)
         ↓
REST API (Google Apps Script)
         ↓
Google Sheets (Database)
```

| Layer | Teknologi |
|---|---|
| Frontend | PWA, Vanilla JS, HTML/CSS |
| Backend | Google Apps Script (Serverless) |
| Database | Google Sheets |

---

## 🚀 Cara Menjalankan

### Frontend (PWA)

```bash
# Buka langsung di browser
open index.html

# Atau gunakan Live Server di VS Code
http://localhost:5500
```

### Backend (GAS)

Backend sudah di-deploy sebagai Web App. Tidak perlu setup tambahan — langsung hit endpoint di bawah.

**Base URL:**
```
https://script.google.com/macros/s/AKfycbyNepWGdF-dVMOBVnv_4JXS4Ik1e2MHP8Pp3e4zd45ARqpMujrxg3gmIQbjt7xbk7Yz3A/exec
```

---

## 📡 Endpoint API

### 🟢 Presensi QR

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/presence/qr/generate` | Generate QR dari server |
| `POST` | `/presence/checkin` | Validasi & proses check-in |
| `GET` | `/presence/status` | Cek status presensi user |

### 📱 Sensor Accelerometer

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/telemetry/accel` | Simpan data sensor ke Sheets |
| `GET` | `/telemetry/accel/latest` | Ambil data terakhir |

### 🗺️ GPS Tracking

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/telemetry/gps` | Update lokasi device |
| `GET` | `/telemetry/gps/latest` | Ambil posisi terakhir |
| `GET` | `/telemetry/gps/history` | Ambil riwayat tracking |

---

## 🛠️ Tech Stack

- **Backend:** Google Apps Script (GAS) — serverless REST API
- **Database:** Google Sheets
- **Frontend:** Vanilla JS, PWA (Progressive Web App)
- **Komunikasi:** HTTP REST (JSON)

---

## 📁 Struktur Project

```
cloudtelemetry/
├── backend-gas/                # Backend Google Apps Script
│   ├── .clasp.json             # Konfigurasi CLASP (deploy GAS)
│   ├── appsscript.json         # Manifest GAS
│   └── Code.js                 # Logic utama REST API
│
├── pwa/                        # Frontend Progressive Web App
│   ├── icons/
│   │   ├── icon-192.png        # Icon PWA 192x192
│   │   └── icon-512.png        # Icon PWA 512x512
│   ├── index.html              # Entry point utama
│   ├── map-view.html           # Halaman GPS map
│   ├── api.js                  # Handler request ke GAS API
│   ├── app.js                  # Logic utama aplikasi
│   ├── map-logic.js            # Logic peta & GPS
│   ├── service-worker.js       # PWA service worker (offline support)
│   ├── style.css               # Stylesheet utama
│   ├── map-style.css           # Stylesheet halaman peta
│   └── manifest.json           # PWA manifest
│
└── .gitignore
```
