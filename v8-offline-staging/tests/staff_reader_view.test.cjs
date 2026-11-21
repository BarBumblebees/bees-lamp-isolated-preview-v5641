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
 assert.match(standalone,/href="\.\/staff\.html\?view=reader"/);
 assert.doesNotMatch(standalone,/href="[^"]*#card=/);
});
