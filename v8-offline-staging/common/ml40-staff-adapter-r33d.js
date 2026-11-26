/* R33D: existing staff-shell adapter. Offline draft. Never creates a second login.
 * Identity decoded only for client binding; server independently verifies JWT and rights.
 * No live endpoint in this adapter. */
(function(root){'use strict';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const fail=()=>{throw Error('スタッフ認証・操作状態を確認してください。');};
const same=(a,b)=>!!a&&!!b&&['actor_id','session_id','generation','environment'].every(k=>a[k]===b[k]);
const validGen=x=>Number.isSafeInteger(x)&&x>=0;
const oldPending='shop-point-nfc.checkout-pending.v5',newPending='shop-point-nfc.ml40.pending.v1',lockName='shop-point-nfc.point-operation.v1';
const mutations=new Set(['save_registered_card_note_v1','process_checkout_once_for_card_v1','award_visit_point_for_card_v1','award_encounter_point','manage_registered_card_v1','reissue_card_with_qr_v1','activate_card_with_qr_v1']);
const readOnlyDirectory=new Set(['select']);
function classify(path,args){const m=typeof path==='string'&&path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);if(!m)return 'other';const name=m[1];if(name==='manage_card_directory_points_v1')return readOnlyDirectory.has(args?.p_action)?'other':'mutation';return mutations.has(name)?'mutation':'other';}
function claims(bearer,decode,issuer){
 if(typeof bearer!=='string'||bearer.length>16000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(bearer))fail();
 let c;try{c=decode(bearer);}catch{fail();}
 if(!c||c.iss!==issuer+'/auth/v1'||c.role!=='authenticated'||!(c.aud==='authenticated'||Array.isArray(c.aud)&&c.aud.includes('authenticated'))||!uuid(c.sub)||!uuid(c.session_id)||!Number.isSafeInteger(c.exp)||c.exp<=0)fail();
 return c;
}
function create({getState,decode,issuer,refresh,send,storage,lock,verify,now=()=>Date.now(),allowLive=false}){
 if(allowLive!==false||![getState,decode,refresh,send,lock,verify,now].every(x=>typeof x==='function')||!storage||typeof issuer!=='string'||!/^https:\/\/[a-z0-9.-]+$/.test(issuer))fail();
 function getAuth(){
  const a=getState();if(!a||a.current!==true||a.verified!==true||!validGen(a.generation)||typeof a.bearer!=='string'||!Number.isFinite(a.expires_at))fail();
  const c=claims(a.bearer,decode,issuer);if(a.actor_id!==c.sub)fail();
  const expires_at=Math.min(a.expires_at,c.exp*1000);
  return Object.freeze({environment:'production',current:true,actor_id:c.sub,session_id:c.session_id,generation:a.generation,bearer:a.bearer,expires_at});
 }
 async function refreshExisting(){const before=getAuth();await refresh();const after=getAuth();if(!same(before,after)||after.expires_at<=now()+10000)fail();}
 async function dispatch(d){const a=getAuth();if(d.bearer!==a.bearer||a.expires_at<=now()+10000)fail();
  // Provided sender must execute exactly once, with no hidden refresh/retry.
  const result=await send({name:d.name,args:d.args,bearer:a.bearer});
  if(!same(a,getAuth()))fail();return result;}
 const bridge=root.BeesR33Bridge.create({getAuth,refresh:refreshExisting,dispatch,storage,verify,withLock:lock,now});
 return Object.freeze({bridge,session:bridge.session,writeEnabled:false});
}
function legacyGuard({storage,lock}){
 if(!storage||typeof lock!=='function')fail();
 const present=k=>{try{return storage.getItem(k)!==null;}catch{return true;}};
 function mayStart(){return !present(oldPending)&&!present(newPending);}
 async function call(path,args,send){
  if(typeof send!=='function')fail();
  if(classify(path,args)!=='mutation')return send();
  return lock(lockName,async()=>{
   if(present(newPending))fail();
   // Existing checkout journal is allowed only for its own matching retry/commit.
   if(present(oldPending)){
    let p;try{p=JSON.parse(storage.getItem(oldPending));}catch{fail();}
    const isCheckout=path==='/rest/v1/rpc/process_checkout_once_for_card_v1'||(path==='/rest/v1/rpc/manage_card_directory_points_v1'&&args?.p_action==='checkout');
    if(!isCheckout||!p||!uuid(p.request_id)||!uuid(p.member_id)||!uuid(p.store_id)||!Number.isSafeInteger(p.total_yen)||!Number.isSafeInteger(p.redeem_points)||p.request_id!==args?.p_request_id||p.store_id!==args?.p_store_id||p.total_yen!==args?.p_total_yen||p.redeem_points!==args?.p_redeem_points||(path==='/rest/v1/rpc/process_checkout_once_for_card_v1'&&p.member_id!==args?.p_member_id))fail();
   }
   return send();
  });
 }
 return Object.freeze({call,mayStart,newPending:()=>present(newPending),oldPending:()=>present(oldPending)});
}
root.BeesR33StaffAdapter=Object.freeze({create,legacyGuard,classify,lockName,oldPending,newPending,writeEnabled:false});})(globalThis);
