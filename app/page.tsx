"use client";

import { useState, useEffect, useRef } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";

export default function ScannerPage() {
  const [status, setStatus] = useState("Arahkan kamera ke QR Code");
  const nimRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);
  
  // "Gembok" untuk mencegah kamera dipanggil dua kali oleh React Strict Mode
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    // Jika scanner sudah menyala, hentikan eksekusi selanjutnya
    if (scannerRef.current) return;

    // Inisialisasi scanner dengan pengaturan yang lebih ramah HP mobile
    const scanner = new Html5QrcodeScanner(
      "reader",
      { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0, // Membantu mencegah layar hitam/gepeng di HP
      },
      false // false = matikan UI bawaan library yang jelek
    );
    
    scannerRef.current = scanner;

    scanner.render(
      async (decodedText) => {
        const nim = nimRef.current?.value.trim();
        
        if (!nim) {
          setStatus("❌ Isi NIM kamu terlebih dahulu!");
          return;
        }

        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        
        scanner.pause(true); 
        setStatus("⏳ Memproses data presensi...");

        try {
          const res = await fetch("/api/checkin", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              user_id: nim,
              device_id: "nextjs-web-scanner",
              // Matkul & Sesi tidak perlu dikirim karena backend kita sudah pintar (auto-detect)
              qr_token: decodedText,
              ts: new Date().toISOString()
            })
          });

          const result = await res.json();
          
          if (result.ok) {
            setStatus("✅ Berhasil Check-In!");
            // Jika sukses, biarkan kamera mati
          } else {
            setStatus(`❌ Gagal: ${result.error}`);
            // Jika gagal (token expired/salah), nyalakan kamera lagi setelah 3 detik
            setTimeout(() => {
              isProcessingRef.current = false;
              scanner.resume();
            }, 3000);
          }
        } catch (err) {
          setStatus("❌ Error Jaringan. Coba lagi.");
          setTimeout(() => {
            isProcessingRef.current = false;
            scanner.resume();
          }, 3000);
        }
      },
      (err) => {
        // Abaikan error pembacaan frame kosong
      }
    );

    // Saat user keluar dari halaman, bersihkan memori dan matikan kamera
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
        scannerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white font-sans">
      <div className="bg-gray-800 p-6 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700">
        <h2 className="text-2xl font-bold text-indigo-400 mb-2 text-center">Scan QR Kelas</h2>
        <p className="text-gray-400 text-sm mb-6 text-center">Isi NIM kamu, lalu arahkan kamera</p>

        <input
          type="text"
          ref={nimRef}
          placeholder="Masukkan NIM (Cth: 20230001)"
          className="w-full p-3 rounded-lg bg-gray-900 border border-indigo-500 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-6 text-center font-mono uppercase"
        />

        {/* Kotak Scanner - Dihapus pengaturan border yang bikin bentrok di HP */}
        <div 
          id="reader" 
          className="w-full rounded-lg mb-6 bg-black min-h-[250px]"
          style={{ border: 'none' }}
        ></div>

        <div className="bg-gray-900 p-4 rounded-lg text-center font-medium border border-gray-700 shadow-inner">
          {status}
        </div>
      </div>
    </div>
  );
}