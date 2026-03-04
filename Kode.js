// // ================= ENTRY =================
// function doGet(e){
//   return handleRequest(e,"GET");
// }

// function doPost(e){
//   return handleRequest(e,"POST");
// }

// // ================= ROUTER =================
// function handleRequest(e,method){

//   const path =
//     (e.parameter && e.parameter.path)
//       ? e.parameter.path : "";

//   // ⭐ ROUTE
//   if(method==="GET" && path==="ui"){
//     return HtmlService
//       .createHtmlOutputFromFile("Index")
//       .setTitle("Dashboard Presensi QR")
//       .addMetaTag("viewport","width=device-width, initial-scale=1");
//   }

//   // ===== API ROUTES =====
//   if(method==="POST" && path==="presence/qr/generate")
//     return generateQR(e);

//   if(method==="POST" && path==="presence/checkin")
//     return checkin(e);

//   if(method==="GET" && path==="presence/status")
//     return presenceStatus(e);

    

//   return sendError("endpoint_not_found");
// }

// // ================= RESPONSE =================
// function sendSuccess(data){
//   return ContentService
//     .createTextOutput(JSON.stringify({ok:true,data}))
//     .setMimeType(ContentService.MimeType.JSON);
// }

// function sendError(error){
//   return ContentService
//     .createTextOutput(JSON.stringify({ok:false,error}))
//     .setMimeType(ContentService.MimeType.JSON);
// }

// // ISO format tanpa millisecond
// function isoNow(){
//   return new Date().toISOString().replace('.000','');
// }

// // ================= GENERATE QR =================
// function generateQR(e){

//   const body = JSON.parse(e.postData.contents);

//   if(!body.course_id)
//     return sendError("missing_field: course_id");

//   if(!body.session_id)
//     return sendError("missing_field: session_id");

//   const token =
//     "TKN-"+Utilities.getUuid().substring(0,6).toUpperCase();

//   const now = new Date();
//   const expiry = new Date(now.getTime()+120000); // 2 menit

//   const sheet =
//     SpreadsheetApp.getActive()
//       .getSheetByName("tokens");

//   sheet.appendRow([
//     token,
//     body.course_id,
//     body.session_id,
//     isoNow(),
//     expiry.toISOString().replace('.000','')
//   ]);

//   return sendSuccess({
//     qr_token: token,
//     expires_at: expiry.toISOString().replace('.000','')
//   });
// }

// // ================= CHECKIN =================
// function checkin(e){

//   const body = JSON.parse(e.postData.contents);

//   const required=[
//     "user_id","device_id",
//     "course_id","session_id",
//     "qr_token","ts"
//   ];

//   for(let f of required){
//     if(!body[f])
//       return sendError("missing_field: "+f);
//   }

//   // ===== VALIDASI TOKEN =====
//   const tokenSheet =
//     SpreadsheetApp.getActive().getSheetByName("tokens");

//   const rows = tokenSheet.getDataRange().getValues();

//   let tokenRow=-1;

//   for(let i=1;i<rows.length;i++){
//     if(String(rows[i][0]) === String(body.qr_token)){
//       tokenRow=i+1;
//       break;
//     }
//   }

//   if(tokenRow===-1)
//     return sendError("token_invalid");

//   const tokenData = rows[tokenRow-1];

//   if(
//     String(tokenData[1]) !== String(body.course_id) ||
//     String(tokenData[2]) !== String(body.session_id)
//   ){
//     return sendError("token_invalid");
//   }

//   const expiry=new Date(tokenData[4]);

//   if(expiry < new Date())
//     return sendError("token_expired");

//   // ===== CEK DOUBLE CHECK-IN =====
//   const presenceSheet =
//     SpreadsheetApp.getActive()
//       .getSheetByName("presence");

//   const existing =
//     presenceSheet.getDataRange().getValues();

//   for(let i=1;i<existing.length;i++){
//     if(
//       String(existing[i][1]) === String(body.user_id) &&
//       String(existing[i][3]) === String(body.course_id) &&
//       String(existing[i][4]) === String(body.session_id)
//     ){
//       return sendError("already_checked_in");
//     }
//   }

//   // ===== SIMPAN PRESENSI =====
//   const presenceId="PR-"+Date.now();

//   presenceSheet.appendRow([
//     presenceId,
//     body.user_id,
//     body.device_id,
//     body.course_id,
//     body.session_id,
//     body.qr_token,
//     body.ts,
//     isoNow()
//   ]);

//   return sendSuccess({
//     presence_id:presenceId,
//     status:"checked_in"
//   });
// }

// // ================= STATUS =================
// function presenceStatus(e){

//   const user=e.parameter.user_id;
//   const course=e.parameter.course_id;
//   const session=e.parameter.session_id;

//   if(!user) return sendError("missing_field: user_id");
//   if(!course) return sendError("missing_field: course_id");
//   if(!session) return sendError("missing_field: session_id");

//   const sheet=
//     SpreadsheetApp.getActive()
//       .getSheetByName("presence");

//   const rows=sheet.getDataRange().getValues();

//   for(let i=rows.length-1;i>=1;i--){
//     if(
//       String(rows[i][1]) === String(user) &&
//       String(rows[i][3]) === String(course) &&
//       String(rows[i][4]) === String(session)
//     ){
//       return sendSuccess({
//         user_id:user,
//         course_id:course,
//         session_id:session,
//         status:"checked_in",
//         last_ts:rows[i][6]
//       });
//     }
//   }

//   return sendError("not_found");
// }

// // ============= BRIDGE ==============
// function processGenerateQR(payload){

//   const fakeEvent = {
//     postData:{
//       contents: JSON.stringify(payload)
//     }
//   };

//   const result = generateQR(fakeEvent);

//   return JSON.parse(result.getContent());
// }

