# CloudTelemetry – Backend Google Apps Script + PWA Client
Project ini adalah sistem presensi, telemetry, dan maps berbasis cloud dengan arsitektur:
1. Backend utama: Google Apps Script (GAS)
2. Database: Google Sheets
3. Client: Progressive Web App (PWA) Vanilla JS
Fokus utama sistem ini ada di backend serverless menggunakan GAS sebagai REST API.

## Arsitektur Sistem
```bash
PWA Client (Frontend)
# next
REST API Google Apps Script (GAS)
# next
Google Sheets (Database)
```

## Backend Utama (Google Apps Script)
Backend ini dibangun menggunakan Google Apps Script sebagai serverless REST API.
### Base URL API
```bash
QR = https://docs.google.com/spreadsheets/d/1BxNXy6JwtlsV07_yg7u30OcNe5skqGH8hkzHiwxR5zw/edit?usp=drivesdk

Telemetry: https://docs.google.com/spreadsheets/d/1X6Svgav9Cmfr3OGdfGrxkNgPRuIbC8xR5aRcOQt6-Aw/edit?usp=sharing
```

## Menjalankan Code di Lokal
Pertama, jalankan development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Buka [http://localhost:3000](http://localhost:3000) dengan browser Anda untuk melihat hasilnya.

## Endpoint API (GAS Backend)
Backend ini dibangun menggunakan Google Apps Script sebagai serverless REST API.
### Presensi QR (Server Logic di GAS)
1. POST /presence/qr/generate → generate QR dari server
2. POST /presence/checkin → validasi & proses check-in
3. GET /presence/status → cek status presensi user

### Sensor Accelerometer (Processing di GAS)
1. POST /telemetry/accel → simpan data sensor ke Sheets
2. GET /telemetry/accel/latest → ambil data terakhir

### GPS Tracking (Managed by GAS)
1. POST /telemetry/gps → update lokasi device
2. GET /telemetry/gps/latest → ambil posisi terakhir
3. GET /telemetry/gps/history → ambil riwayat tracking

#### Kelompok 3
#### C1

