// ================= ACCEL BATCH =================
function accelBatch(e){

  const body = JSON.parse(e.postData.contents);

  if(!body.device_id)
    return sendError("missing_field: device_id");

  if(!body.ts)
    return sendError("missing_field: ts");

  if(!body.samples || body.samples.length===0)
    return sendError("missing_field: samples");

  const sheet =
    SpreadsheetApp.getActive()
      .getSheetByName("accel");

  const recorded = isoNow();

  const rows = body.samples.map(s => [
    body.device_id,
    s.t,
    s.x,
    s.y,
    s.z,
    body.ts,
    recorded
  ]);

  sheet
    .getRange(sheet.getLastRow()+1,1,rows.length,7)
    .setValues(rows);

  return sendSuccess({
    accepted: rows.length
  });
}

// ================= ACCEL LATEST =================
function accelLatest(e){

  const device = e.parameter.device_id;

  if(!device)
    return sendError("missing_field: device_id");

  const sheet =
    SpreadsheetApp.getActive()
      .getSheetByName("accel");

  const rows = sheet.getDataRange().getValues();

  for(let i=rows.length-1;i>=1;i--){

    if(String(rows[i][0]) === String(device)){
      return sendSuccess({
        t: rows[i][1],
        x: rows[i][2],
        y: rows[i][3],
        z: rows[i][4]
      });
    }
  }

  return sendError("device_not_found");
}

function accelDevices(){
  const sheet = SpreadsheetApp.getActive().getSheetByName("accel");
  const lastRow = sheet.getLastRow();

  if(lastRow < 2) return sendSuccess({ devices: [] });

  const rows    = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // ✅ height = lastRow-1
  const devices = [...new Set(rows.map(r => r[0]).filter(Boolean))];
  return sendSuccess({ devices });
}

