
function testGenerateQR() {
  const payload = {
    course_id: "cloud-101",
    session_id: "sesi-01",
    ts: new Date().toISOString() // ISO-8601 UTC
  };

  const res = routeRequest("POST", {
    pathInfo: "/presence/qr/generate",
    postData: {
      contents: JSON.stringify(payload)
    }
  });

  Logger.log(res.getContent());
}

function testCheckin() {
  // 1️⃣ Generate QR dulu
  const qrRes = routeRequest("POST", {
    pathInfo: "/presence/qr/generate",
    postData: {
      contents: JSON.stringify({
        course_id: "cloud-101",
        session_id: "sesi-01",
        ts: new Date().toISOString()
      })
    }
  });

  // 2️⃣ Parse response JSON
  const qrData = JSON.parse(qrRes.getContent());

  Logger.log("QR Response: " + JSON.stringify(qrData));

  // 3️⃣ Ambil token otomatis
  const token = qrData.data.qr_token;

  // 4️⃣ Checkin pakai token tersebut
  const payload = {
    user_id: "U001",
    device_id: "android-001",
    course_id: "cloud-101",
    session_id: "sesi-01",
    qr_token: token,
    ts: new Date().toISOString()
  };

  const res = routeRequest("POST", {
    pathInfo: "/presence/checkin",
    postData: {
      contents: JSON.stringify(payload)
    }
  });

  Logger.log("Checkin Response: " + res.getContent());
}