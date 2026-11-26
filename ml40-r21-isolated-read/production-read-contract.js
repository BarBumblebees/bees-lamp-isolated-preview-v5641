/* ML40 R1: production response contracts. Offline only; no network or storage. */
(function(root){'use strict';
const fail=reason=>{throw new Error(reason)};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)&&!['T','V','E','C'].some(c=>v===c.repeat(43));
const integer=v=>Number.isSafeInteger(v);
const balance=v=>integer(v)&&v>=0&&v<=10000000;
const text=v=>typeof v==='string'&&!!v.trim();
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nullableText=v=>v===null||text(v);
const cardNo=v=>v===null||(typeof v==='string'&&/^[0-9]{6}$/.test(v)&&v!=='000000');
function history(rows,storeKey){
 if(!Array.isArray(rows)||rows.length>20)fail('history_shape');
 return rows.map(h=>{
  if(!obj(h)||!text(h.kind)||!integer(h.delta)||!date(h.created_at)||!nullableText(h[storeKey])||!nullableText(h.encounter_staff_name))fail('history_row');
  return Object.freeze({kind:h.kind,delta:h.delta,created_at:h.created_at,store:h[storeKey],encounter_staff_name:h.encounter_staff_name});
 });
}
function stores(d){if(!Array.isArray(d))fail('stores_shape');const seen=new Set();return d.map(s=>{if(!obj(s)||!uuid(s.id)||!text(s.name)||seen.has(s.id))fail('store_row');seen.add(s.id);return Object.freeze({id:s.id,name:s.name});});}
function card(d){
 if(d===null)return Object.freeze({state:'not_found'});
 if(!obj(d))fail('card_shape');
 if(d.status==='revoked')return Object.freeze({state:'revoked'});
 if(d.status==='prepared'){if(!cardNo(d.card_number))fail('card_number');return Object.freeze({state:'prepared',cardNumber:d.card_number});}
 if(d.status!=='active'||!uuid(d.member_id)||!text(d.display_name)||!balance(d.balance)||!cardNo(d.card_number))fail('card_active');
 return Object.freeze({state:'active',memberId:d.member_id,name:d.display_name,balance:d.balance,cardNumber:d.card_number,history:history(d.history,'store')});
}
function directory(d,status){
 if(!['active','revoked'].includes(status)||!obj(d)||!nullableText(d.scope_store_name)||typeof d.has_more!=='boolean'||!Array.isArray(d.cards)||d.cards.length>30||(d.has_more&&d.cards.length!==30))fail('directory_shape');
 const seen=new Set();const cards=d.cards.map(c=>{
  if(!obj(c)||!uuid(c.id)||seen.has(c.id)||!cardNo(c.card_number)||!text(c.display_name)||!balance(c.balance)||typeof c.customer_note!=='string'||[...c.customer_note].length>60||/[\x00-\x1f\x7f]/u.test(c.customer_note)||!date(c.issued_at)||!nullableText(c.store_name)||!nullableText(c.staff_name)||(status==='active'?c.revoked_at!==null:!date(c.revoked_at)))fail('directory_row');
  seen.add(c.id);return Object.freeze({cardId:c.id,cardNumber:c.card_number,name:c.display_name,balance:c.balance,note:c.customer_note,issuedAt:c.issued_at,revokedAt:c.revoked_at,store:c.store_name,staff:c.staff_name});
 });return Object.freeze({scopeStoreName:d.scope_store_name,hasMore:d.has_more,cards});
}
function activity(d){
 if(!obj(d)||!Array.isArray(d.visits)||!(d.encounter_count===null||(integer(d.encounter_count)&&d.encounter_count>=0)))fail('activity_shape');
 const visits=d.visits.map(v=>{if(!obj(v)||!nullableText(v.store_name)||!integer(v.count)||v.count<1||!date(v.last_at))fail('visit_summary');return Object.freeze({store:v.store_name,count:v.count,lastAt:v.last_at});});
 return Object.freeze({visits,encounterCount:d.encounter_count,history:history(d.history,'store_name')});
}
function checkoutReceipt(d){
 // Existing RPC is owner-scoped but does not return request/card/store binding.
 // Do NOT convert this to ML39's verified receipt or release a pending lock.
 if(!obj(d))fail('receipt_shape');
 if(d.status==='unconfirmed')return Object.freeze({state:'unknown',releasePending:false});
 if(d.status!=='confirmed'||!integer(d.paid_yen)||d.paid_yen<0||!integer(d.redeemed_points)||d.redeemed_points<0||d.redeemed_points%10!==0||!integer(d.earned_points)||d.earned_points!==Math.floor(d.paid_yen/100)*5||!balance(d.balance_after))fail('receipt_amount');
 return Object.freeze({state:'owner_receipt_unbound',releasePending:false,paid:d.paid_yen,redeemed:d.redeemed_points,earned:d.earned_points,balanceAfter:d.balance_after});
}
// Existing production API argument contracts, not connected to any endpoint.
function request(kind,p={}){
 if(!obj(p))fail('args');
 switch(kind){
 case 'stores':return {name:'staff_card_stock_stores',args:{}};
 case 'card':if(!token(p.token))fail('token');return {name:'staff_card_details_v3',args:{p_card_token:p.token}};
 case 'directory':if(typeof p.query!=='string'||[...p.query].length>80||!['all','reserved','general','legacy'].includes(p.kind)||!['active','revoked'].includes(p.status)||!integer(p.offset)||p.offset<0||p.offset>2147483647)fail('directory_args');return {name:'list_registered_cards_v2',args:{p_query:p.query,p_kind:p.kind,p_offset:p.offset,p_status:p.status}};
 case 'activity':if(!uuid(p.cardId))fail('card_id');return {name:'registered_card_activity_v2',args:{p_card_id:p.cardId}};
 case 'checkoutReceipt':if(!uuid(p.requestId))fail('request_id');return {name:'staff_checkout_result_by_request_v1',args:{p_request_id:p.requestId}};
 default:fail('operation_not_allowed');
 }
}
const api=Object.freeze({request,stores,card,directory,activity,checkoutReceipt,writeEnabled:false});
if(typeof module==='object'&&module.exports)module.exports=api;else root.BeesProductionReadContract=api;
})(globalThis);
