(()=>{'use strict';
// Offline only. Never sends requests, writes storage, or releases a lock itself.
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const int=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const actions=['checkout','memo','visit','encounter'];
const ids=['request_id','actor_id','member_id','card_id','store_id'];
const bound=x=>x&&ids.every(k=>uuid(x[k]))&&actions.includes(x.action);
const unknown=reason=>Object.freeze({state:'unknown',releasePending:false,reason});
const valid=()=>Object.freeze({state:'confirmed',releasePending:true});
function verify(expected,receipt,current){
 if(!bound(expected)||!bound(current)||current.current!==true||current.environment!=='isolated'||!ids.every(k=>current[k]===expected[k])||current.action!==expected.action)return unknown('context');
 if(!bound(receipt)||receipt.environment!=='isolated'||receipt.status!=='confirmed'||!ids.every(k=>receipt[k]===expected[k])||receipt.action!==expected.action)return unknown('binding');
 const d=receipt.result;if(!d||typeof d!=='object'||Array.isArray(d))return unknown('result');
 if(expected.action==='checkout'){
  if(!int(expected.total,1,100000000)||!int(expected.redeem,0,expected.total)||expected.redeem%10||!int(expected.before,0,10000000)||expected.redeem>expected.before||!uuid(expected.confirmation_id)||!/^\d{1,19}$/.test(String(expected.revision))||typeof expected.revision!=='string')return unknown('checkout_intent');
  const paid=expected.total-expected.redeem,earned=Math.floor(paid/100)*5,after=expected.before-expected.redeem+earned;
  const fields={total:expected.total,redeem:expected.redeem,paid,earned,balance_before:expected.before,delta:earned-expected.redeem,balance_after:after,confirmation_id:expected.confirmation_id,revision_before:expected.revision};
  if(!int(after,0,10000000)||!Object.entries(fields).every(([k,v])=>d[k]===v))return unknown('checkout_result');
 }else if(expected.action==='memo'){
  if(!int(expected.memo_version,0,2147483646)||!hash(expected.note_sha256)||d.memo_version!==expected.memo_version+1||d.note_sha256!==expected.note_sha256)return unknown('memo_result');
 }else{
  if(!uuid(d.transaction_id)||!int(d.balance,0,10000000)||!int(d.delta,1,2147483647)||!int(expected.delta,1,2147483647)||d.delta!==expected.delta||(expected.action==='encounter'&&d.delta!==1))return unknown('point_result');
 }
 return valid();
}
// Old unbound receipts, missing receipts and rejections never unlock.
globalThis.BeesReceiptIsolatedR19=Object.freeze({verify,writeEnabled:false});
})();