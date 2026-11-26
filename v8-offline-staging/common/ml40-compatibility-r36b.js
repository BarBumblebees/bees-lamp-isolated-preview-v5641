/* R36B saved 20261124 candidate compatibility. Offline-only, no live network. */
(function(root){'use strict';
const KEY='shop-point-nfc.ml40.pending.v1',LOCK='bees.production.checkout.v6';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const fail=x=>{throw Error(x)};
const same=(a,b)=>!!a&&!!b&&['actor_id','session_id','generation'].every(k=>a[k]===b[k]);
const mutations=new Set(['award_visit_point_for_card_v1','process_checkout_once_for_card_v1','award_encounter_point','save_registered_card_note_v1','manage_registered_card_v1','reissue_card_with_qr_v1','activate_card_with_qr_v1','prepare_member_cards_v3']);
const readDirectory=new Set(['select']);
function classify(path,args){
 const m=typeof path==='string'&&path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);if(!m)return {kind:'other'};
 let name=m[1],p=args;
 if(name==='staff_scoped_point_operation_v1'){name=args?.p_operation;p=args?.p_input;if(!['award_visit_point_for_card_v1','process_checkout_once_for_card_v1','manage_card_directory_points_v1'].includes(name)||!p||typeof p!=='object')return {kind:'deny'};}
 if(name==='manage_card_directory_points_v1'&&readDirectory.has(p?.p_action))return {kind:'other'};
 if(name==='process_checkout_once_for_card_v1'||name==='manage_card_directory_points_v1'&&p?.p_action==='checkout')return {kind:'checkout',p};
 if(name==='manage_card_directory_points_v1'||mutations.has(name))return {kind:'mutation',p};
 if(typeof name==='string'&&name.startsWith('ml40_'))return {kind:'deny'}; // new path only through its bridge
 return {kind:'other'};
}
function create({storage,checkoutGuard,lock,session,scopeReady=()=>false,permissions,encounterEnabled,directoryGrant,allowLive=false}){
 if(allowLive!==false||!storage||checkoutGuard?.key!==LOCK||![lock,session,scopeReady,permissions,encounterEnabled,directoryGrant].every(x=>typeof x==='function'))fail('draft_only');
 function newPending(){try{return storage.getItem(KEY)!==null}catch{return true}}
 function authorize(d,a){
  if(!scopeReady()||!same(session(),a)||!d||!d.args||!uuid(d.args.p_store_id))return false;
  const p=d.args,name=d.name,isDirectory=name.startsWith('ml40_api_directory_');
  if(!isDirectory&&!name.startsWith('ml40_api_scan_'))return false;
  if(isDirectory&&!directoryGrant(p.p_store_id,a))return false;
  const grants=permissions(p.p_store_id,a);if(!(grants instanceof Set))return false;
  if(name.endsWith('_checkout_confirm_v1')||name.endsWith('_checkout_once_v1'))return grants.has('checkout.execute');
  if(name.endsWith('_point_once_v1'))return p.p_action==='visit'?grants.has('point.visit.award'):p.p_action==='encounter'&&encounterEnabled(a)===true;
  return name==='ml40_api_directory_memo_once_v1';
 }
 async function legacyCall(path,args,send){
  if(typeof send!=='function')fail('sender');const k=classify(path,args);
  if(k.kind==='deny')fail('rpc_denied');if(k.kind==='other')return send();
  const a=session();if(!a)fail('auth');
  return lock(LOCK,async()=>{if(!same(a,session())||newPending())fail('pending_or_session');const old=checkoutGuard.read();
   if(k.kind==='checkout'){if(!old||old.invalid||old.legacy!==undefined||old.request_id!==k.p?.p_request_id||old.actor_id!==a.actor_id)fail('checkout_reservation');}
   else if(old!==null)fail('checkout_pending');
   return send(); // existing wrapper still applies scoped RPC; no recursion or retry
  });
 }
 return Object.freeze({newPending,authorize,legacyCall});
}
root.BeesR36Compatibility=Object.freeze({create,classify,KEY,LOCK,writeEnabled:false});})(globalThis);