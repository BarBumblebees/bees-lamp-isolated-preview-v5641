// Static integration guard for the isolated authenticated reader view.
// Run: node --test v8-offline-staging/tests/*.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const staff=fs.readFileSync(path.join(__dirname,'../staff.html'),'utf8');
const standalone=fs.readFileSync(path.join(__dirname,'../nfc-reader.html'),'utf8');
const css=staff.slice(staff.indexOf('<style>'),staff.indexOf('</style>'));
const lookup=staff.slice(staff.indexOf('async function lookupCard(raw){'),staff.indexOf("byId('lookupButton').addEventListener"));
test('authenticated reader mode exists and preserves logout and member result',()=>{
 assert.match(staff,/get\('view'\)\s*===\s*'reader'/);
 assert.match(css,/#staffLogoutPanel:not\(\.hidden\)/);
 assert.match(css,/#pointOperationsHome/);
 assert.match(css,/#selectedMemberPanel:not\(\.hidden\)/);
 assert.match(css,/#staffCardDetails:not\(\.hidden\)/);
 assert.match(css,/#pointOperations button/);
 assert.match(staff,/function renderStaffCardDetails\(\)/);
});
test('reader lookup uses existing staff authorization and does not activate prepared cards',()=>{
 assert.match(lookup,/validBusinessDay\(\)/);
 assert.match(lookup,/staff_prepared_card_status/);
 assert.match(lookup,/staff_card_details_v3/);
 assert.match(lookup,/classList\.contains\('reader-only'\)/);
 assert.match(lookup,/登録操作は通常のスタッフ画面/);
 assert.match(lookup,/stillCurrent\(\)/);
 assert.match(lookup,/lookupEpoch/);
});
test('isolated standalone reader cannot connect to database or expose a token in navigation',()=>{
 assert.match(standalone,/connect-src 'none'/);
 assert.match(standalone,/href="\.\/staff-card-reader\.html"/);
 assert.doesNotMatch(standalone,/href="[^"]*#card=/);
});

test('logout clears the previous member result and scanning cannot overlap lookup',()=>{
 const clear=staff.slice(staff.indexOf("function clearAuth("),staff.indexOf("function validBusinessDay()"));
 const scan=staff.slice(staff.indexOf("byId('scanCard').addEventListener"),staff.indexOf("async function fetchActivationStores()"));
 assert.match(clear,/lookupResult'\)\.textContent=''/);
 assert.match(clear,/lookupResult'\)\.classList\.add\('hidden'\)/);
 assert.match(scan,/if\(lookingUp\)/);
});

test('reader-only result panel hides operational inputs while retaining member summary and history',()=>{
 assert.match(css,/#selectedMemberPanel > :not\(#selectedMemberInfo\):not\(#staffCardDetails\)/);
 assert.match(css,/#selectedMemberPanel:not\(\.hidden\)/);
 assert.match(css,/#staffCardDetails:not\(\.hidden\)/);
});

test('old lookup cannot lock or overwrite a newly authenticated session',()=>{
 const clear=staff.slice(staff.indexOf("function clearAuth("),staff.indexOf("function validBusinessDay()"));
 assert.match(clear,/lookupEpoch\+\+/);
 assert.match(clear,/lookingUp=false/);
 assert.match(lookup,/if\(epoch===lookupEpoch\)\{lookingUp=false/);
 assert.match(lookup,/if\(!stillCurrent\(\)\|\|!validBusinessDay\(\)\)return;/);
});

test('reader-only lookup does not retain card token for point mutation',()=>{
 assert.match(lookup,/selectMember\(result,document\.body\.classList\.contains\('reader-only'\)\?null:cardToken\)/);
});

test('read-only mode blocks all point mutation click handlers before any network request',()=>{
 for(const id of ['awardVisit','awardEncounter','checkoutConfirm','checkoutRetry']){
  const start=staff.indexOf("byId('"+id+"').addEventListener('click',async()=>{");
  assert.ok(start>=0,id+' click handler must exist');
  const first=staff.slice(start,start+200);
  assert.match(first,/if\(document\.body\.classList\.contains\('reader-only'\)\)return;/,id+' must reject reader mode');
 }
});

test('isolated reader stays read-only while live candidate requires authorized card selection',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../staff-card-reader.html'),'utf8');
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(page,/common\/staff_card_reader\.js/);
 assert.match(page,/connect-src 'none'/);
 assert.match(code,/BeesNfcReader\.start/);
 assert.match(code,/staff_card_stock_stores/);
 assert.match(code,/staff_prepared_card_status/);
 assert.match(code,/staff_card_details_v3/);
 assert.match(code,/p_action:'select'/);
 assert.match(code,/String\(detail.member_id\|\|''\)!==String\(r.member_id\)/);
 assert.match(code,/CHECKOUT_PENDING/);
 assert.match(code,/p_request_id:p.request_id/);
 assert.match(code,/pendingCheckout\(\)/);
 assert.doesNotMatch(code,/activate_card|grant_type=refresh_token/);
 assert.doesNotMatch(code,/grant_type=refresh_token/);
});

test('live candidate includes checkout and reissue controls while isolated reader cannot mutate',()=>{
 const live=fs.readFileSync(path.join(__dirname,'../staff-card-reader-live-candidate.html'),'utf8');
 const isolated=fs.readFileSync(path.join(__dirname,'../staff-card-reader.html'),'utf8');
 for(const id of ['checkoutInline','checkoutRetryInline','awardVisitInline','suspendInline','confirmReissueInline'])assert.match(live,new RegExp('id="'+id+'"'));
 assert.match(isolated,/connect-src 'none'/);
 assert.match(live,/connect-src https:\/\/cuoruflxfyubjpboqprb\.supabase\.co/);
});

test('live reader checkout state is safe before selecting a card',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/String\(card\?\.id\|\|''\)!==p\?\.card_id/);
 assert.match(code,/card\.revoked_at=true;syncCheckout\(\)/);
 assert.match(code,/staff_directory_points_access_v1/);
});

test('reader checkout preview handles no selected card without dereferencing balance',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/!card\?'カードを読み取ると会計内容を確認できます。'/);
 assert.match(code,/button\.disabled=kind==='note'&&typeof card\.customer_note!=='string'/);
});

test('clearing selected card disables actions and pending checkout rejects negative amounts',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/\['awardVisitInline','checkoutInline','checkoutRetryInline','suspendInline','saveName','saveNote','prepareReissueInline','confirmReissueInline'\]/);
 assert.match(code,/p\.total_yen>=0/);
 assert.match(code,/p\.redeem_points>=0&&p\.redeem_points<=p\.total_yen/);
});

test('selecting a verified directory card restores rename and preserves known note',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/\$\('saveName'\)\.disabled=false/);
 assert.match(code,/if\(note!==null\)selected\.customer_note=note/);
});

test('old card edit completion cannot enable controls for a newer selection',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/if\(card===selectedCard\)button\.disabled=kind==='note'/);
 assert.match(code,/\$\('cardMemo'\)\.textContent=''/);
});

test('reissue buttons become available only in correct suspended and written states',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/\$\('prepareReissueInline'\)\.disabled=!card\|\|!card\.revoked_at/);
 assert.match(code,/\$\('confirmReissueInline'\)\.disabled=!pendingReissue/);
 assert.match(code,/\$\('reissueWritten'\)\?\.addEventListener\('change',syncCheckout\)/);
});

test('card switch clears previous checkout and reissue confirmation without removing pending checkout',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/\$\('reissueWritten'\)\.checked=false/);
 assert.match(code,/\$\('checkoutTotal'\)\.value=''/);
 assert.match(code,/\$\('checkoutRedeem'\)\.value='0'/);
 assert.match(code,/!pending\.card\.revoked_at/);
});

test('checkout retry rejects revoked card and concurrent actions',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/if\(!card\|\|!card\.pointAllowed\|\|card\.revoked_at\|\|actionBusy/);
 assert.match(code,/!selectedCard\?\.pointAllowed\|\|selectedCard\.revoked_at\|\|actionBusy/);
});

test('interrupted lookup releases busy lock and stop clears previous card',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/finally\{if\(mine===epoch\)\{busy=false;/);
 assert.match(code,/\$\('stop'\)\.addEventListener\('click',\(\)=>\{epoch\+\+;stop\(\);busy=false;if\(!actionBusy\)clearMember\(\)/);
});

test('stale NFC lookup completion cannot unlock a newer request',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/finally\{if\(mine===epoch\)\{busy=false;\$\('lookup'\)\.disabled/);
 assert.doesNotMatch(code,/finally\{busy=false;if\(mine===epoch\)/);
});

test('pending checkout validates UUID structure and nonempty identifiers',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../common/staff_card_reader.js'),'utf8');
 assert.match(code,/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
 assert.match(code,/p\.card_id\.length>0&&typeof p\.store_id==='string'&&p\.store_id\.length>0/);
});
