function sendJSON(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sendSuccess(data) {
  return sendJSON({
    ok: true,
    data: data || {}
  });
}

function sendError(message) {
  return sendJSON({
    ok: false,
    error: message
  });
}