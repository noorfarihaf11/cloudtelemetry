"use client";

import { useEffect, useRef, useState } from "react";

export default function GPSPage() {
  const mapRef = useRef<any>(null);
  const myMarkerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const otherUsersLayerRef = useRef<any>(null);
  
  const [deviceId, setDeviceId] = useState("");
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [status, setStatus] = useState("Mencari lokasi GPS...");

  // 🔴 PENTING: GANTI DENGAN URL DEPLOY GAS KAMU
  const API_URL = "https://script.google.com/macros/s/AKfycbyNepWGdF-dVMOBVnv_4JXS4Ik1e2MHP8Pp3e4zd45ARqpMujrxg3gmIQbjt7xbk7Yz3A/exec";

  useEffect(() => {
    // 1. Set Device ID (bisa pakai NIM atau ID acak)
    setDeviceId("MHS-" + Math.floor(Math.random() * 1000));

    // 2. Load Leaflet CSS & JS via CDN (Agar aman dari error SSR Next.js)
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => initMap();
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(link);
      document.head.removeChild(script);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const initMap = () => {
    if (mapRef.current) return; // Cegah map di-render 2 kali

    const L = (window as any).L;
    
    // Inisialisasi peta ke koordinat tengah (misal: Surabaya)
    const map = L.map("map").setView([-7.2575, 112.7521], 13);
    mapRef.current = map;
    otherUsersLayerRef.current = L.layerGroup().addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    // ==========================================
    // FITUR: KLIK PETA UNTUK BUAT RUTE (OSRM)
    // ==========================================
    let destinationPin: any = null;
    
    map.on("click", async (e: any) => {
      if (!myMarkerRef.current) {
        alert("Tunggu sampai lokasimu terdeteksi ya!");
        return;
      }

      const myCurrentLatLng = myMarkerRef.current.getLatLng();
      const destLat = e.latlng.lat;
      const destLng = e.latlng.lng;

      if (destinationPin) map.removeLayer(destinationPin);
      if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);

      destinationPin = L.marker([destLat, destLng]).addTo(map).bindPopup("Menghitung rute...").openPopup();

      // Hitung Rute Gratis pakai OSRM API
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${myCurrentLatLng.lng},${myCurrentLatLng.lat};${destLng},${destLat}?overview=full&geometries=geojson`;

      try {
        const res = await fetch(osrmUrl);
        const data = await res.json();

        if (data.routes && data.routes.length > 0) {
          const routeCoords = data.routes[0].geometry.coordinates.map((c: any[]) => [c[1], c[0]]);
          routeLayerRef.current = L.polyline(routeCoords, { color: "blue", weight: 5 }).addTo(map);
          const distanceKm = (data.routes[0].distance / 1000).toFixed(2);
          destinationPin.setPopupContent(`Jarak: ${distanceKm} km`).openPopup();
        }
      } catch (err) {
        destinationPin.setPopupContent("Gagal hitung rute.");
      }
    });

    // ==========================================
    // FITUR: BACA GPS HP (REALTIME)
    // ==========================================
    if ("geolocation" in navigator) {
      navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          setMyLoc({ lat: latitude, lng: longitude });
          setStatus(`Akurasi GPS: ${Math.round(accuracy)} meter`);

          if (!myMarkerRef.current) {
            myMarkerRef.current = L.marker([latitude, longitude]).addTo(map).bindPopup("Kamu di sini!").openPopup();
            map.setView([latitude, longitude], 15);
          } else {
            myMarkerRef.current.setLatLng([latitude, longitude]);
          }
        },
        (err) => setStatus("Error GPS: Izinkan akses lokasi di browser!"),
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    }
  };

  // ==========================================
  // FITUR: SHARE LIVE LOC KE BACKEND GAS
  // ==========================================
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isSharing && myLoc) {
      interval = setInterval(async () => {
        try {
          // 1. Kirim lokasi saya sesuai kontrak API [cite: 227-235]
          await fetch(`${API_URL}?path=telemetry/gps`, {
            method: "POST",
            body: JSON.stringify({
              device_id: deviceId,
              lat: myLoc.lat,
              lng: myLoc.lng,
              accuracy_m: 10,
              ts: new Date().toISOString()
            })
          });

          // 2. Tarik lokasi teman-teman [cite: 240]
          const res = await fetch(`${API_URL}?path=telemetry/gps/latest`);
          const result = await res.json();
          
          if (result.ok && result.data) {
             const L = (window as any).L;
             otherUsersLayerRef.current.clearLayers(); 

             Object.keys(result.data).forEach(key => {
               if (key !== deviceId) { 
                 const friend = result.data[key];
                 L.marker([friend.lat, friend.lng])
                  .addTo(otherUsersLayerRef.current)
                  .bindPopup(`Teman: ${key} <br> Update: ${new Date(friend.ts).toLocaleTimeString()}`);
               }
             });
          }
        } catch (error) {
          console.error("Gagal sinkronisasi Live Loc");
        }
      }, 5000); 
    }

    return () => clearInterval(interval);
  }, [isSharing, myLoc, deviceId]);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "20px", background: "#f4f4f9", minHeight: "100vh" }}>
      <div style={{ maxWidth: "800px", margin: "auto", background: "white", borderRadius: "10px", boxShadow: "0 4px 10px rgba(0,0,0,0.1)", overflow: "hidden" }}>
        
        <div style={{ padding: "15px 20px", background: "#4a86e8", color: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0 }}>Modul GPS & Live Route</h2>
            <small>ID: {deviceId}</small>
          </div>
          <button 
            onClick={() => setIsSharing(!isSharing)}
            style={{ padding: "10px 15px", border: "none", borderRadius: "5px", fontWeight: "bold", cursor: "pointer", background: isSharing ? "#ff4d4d" : "#00cc66", color: "white" }}
          >
            {isSharing ? "🔴 Berhenti Share" : "🟢 Share Live Loc"}
          </button>
        </div>
        
        <div style={{ padding: "10px", background: "#e8f0fe", color: "#333", fontSize: "14px", textAlign: "center" }}>
          {status} | <b>Ketuk area di peta untuk mencari rute.</b>
        </div>

        <div id="map" style={{ width: "100%", height: "600px", zIndex: 0 }}></div>
      </div>
    </div>
  );
}