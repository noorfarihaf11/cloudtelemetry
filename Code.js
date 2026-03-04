// ================= ENTRY =================
function doGet(e){
  const path = e.parameter.path || "";

  if(path === "viewer"){
    const template = HtmlService.createTemplateFromFile("viewer");
    template.device_id = e.parameter.device_id || "";
    return template.evaluate();
  }

  if(path === "client"){
    return HtmlService.createHtmlOutputFromFile("client");
  }

  return handleRequest(e, "GET");
}

function doPost(e){
  return handleRequest(e,"POST");
}

// ================= ROUTER =================
function handleRequest(e,method){

  const path =
    (e.parameter && e.parameter.path)
      ? e.parameter.path : "";

  // ===== UI =====
  if(method==="GET" && path==="ui")
    return renderUI();

  // ===== PRESENCE MODULE =====
  if(method==="POST" && path==="presence/qr/generate")
    return generateQR(e);

  if(method==="POST" && path==="presence/checkin")
    return checkin(e);

  if(method==="GET" && path==="presence/status")
    return presenceStatus(e);

  // ===== TELEMETRY MODULE =====
  if(method==="POST" && path==="telemetry/accel")
    return accelBatch(e);

  if(method==="GET" && path==="telemetry/accel/latest")
    return accelLatest(e);

  if(method==="GET" && path==="telemetry/accel/devices")
    return accelDevices();

  return sendError("endpoint_not_found");
}