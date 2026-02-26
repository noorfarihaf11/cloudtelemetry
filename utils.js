function jsonSuccess(data) {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      data
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message) {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false,
      error: message
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  return sheet;
}