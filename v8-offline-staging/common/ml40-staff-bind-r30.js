/* Existing staff state is authoritative for launch only; child uses independent trial auth. */
(()=>{'use strict';
const b=byId('openMl40Operations'),s=byId('ml40EntryStatus');
if(!b||!s||!globalThis.BeesR30StaffEntry)return;
function legacyPending(){try{return localStorage.getItem(CHECKOUT_PENDING_KEY)!==null||!!pendingCheckout;}catch{return true;}}
const messages={auth:'スタッフ認証後に利用できます。',busy:'現在の操作・読取を終了してから開いてください。',pending:'既存の未確認会計を照合してから開いてください。',error:'会員操作ページを開けません。',ready:'隔離専用アカウントで別途認証します。'};
const entry=BeesR30StaffEntry.create({state:()=>({authorized:!!token&&validBusinessDay(),home:managementView==='home',busy:!!(operationBusy||activationInProgress||lookingUp),scanning:!!activeScan,legacyPending:legacyPending()}),clearSelection:()=>{resetSelectedMember();byId('lookupResult').classList.add('hidden');byId('lookupUrl').value='';},navigate:target=>location.assign(target),onStatus:key=>{s.textContent=messages[key]||messages.error;}});
function sync(){const key=entry.sync();b.disabled=key!=='ready';s.textContent=messages[key]||messages.error;}
b.addEventListener('click',()=>{entry.open();sync();});
document.addEventListener('visibilitychange',sync);window.addEventListener('pageshow',sync);setInterval(sync,500);sync();
})();