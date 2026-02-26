function routeRequest(method, e) {
  try {
    const path = e.parameter && e.parameter.path ? "/" + e.parameter.path : "/";

    let body = {};
    if (method === "GET" && path === "/") {
      return HtmlService.createHtmlOutputFromFile("index")
        .setTitle("Presensi QR Dinamis")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    // Penanganan Body untuk method POST
    if (method === "POST") {
      if (e.postData && e.postData.contents) {
        body = JSON.parse(e.postData.contents);
      } else if (e.body) {
        body = e.body;
      }
    }

    let result;

    // Endpoint: GET /exec?path=ping
    if (method === "GET" && path === "/ping") {
      return jsonSuccess({ message: "pong" });
    }
    if (method === "GET" && path === "/scan") {
      return HtmlService.createHtmlOutputFromFile("mahasiswa")
        .setTitle("Scan QR — Mahasiswa")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // Endpoint: POST /exec?path=presence/qr/generate
    if (method === "POST" && path === "/presence/qr/generate") {
      result = generateQrToken(body);
    }
    // Endpoint: POST /exec?path=presence/checkin
    else if (method === "POST" && path === "/presence/checkin") {
      result = checkinPresence(body);
    }
    // Endpoint: GET /exec?path=presence/status
    else if (method === "GET" && path === "/presence/status") {
      result = getPresenceStatus(e.parameter || {});
    } else {
      return jsonError("endpoint_not_found: " + path);
    }

    return jsonSuccess(result);
  } catch (err) {
    return jsonError(err.message);
  }
}
