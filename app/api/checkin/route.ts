import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 🔴 PENTING: Masukkan URL Aplikasi Web GAS kamu di sini!
    const gasUrl = "https://script.google.com/macros/s/AKfycbyNepWGdF-dVMOBVnv_4JXS4Ik1e2MHP8Pp3e4zd45ARqpMujrxg3gmIQbjt7xbk7Yz3A/exec";

    const res = await fetch(`${gasUrl}?path=presence/checkin`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(body),
      redirect: "follow", // Wajib untuk GAS karena sistem Google menggunakan 302 Redirect
    });

    const data = await res.json();
    return NextResponse.json(data);
    
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: "Gagal terhubung ke server presensi" }, { status: 500 });
  }
}