/* R36C1: existing saved staff-session owner -> R36 bridge and coordinator.
 * Deliberately no network sender and no new journal writes. This draft is a
 * session-bound read interface; no activation until server permission gates.
 */
(function(root){'use strict';
const fail=x=>{throw Error(x)},uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const same=(a,b)=>!!a&&!!b&&['actor_id','session_id','generation','environment'].every(k=>a[k]===b[k]);
function create({getState,decode,issuer,refresh,sendRead,storage,checkoutGuard,lock,clock,newId,digest,now=()=>Date.now(),readContract,cardHost,allowLive=false}){
 if(allowLive!==false||![getState,decode,refresh,sendRead,lock,clock,newId,digest,now].every(x=>typeof x==='function')||!storage||!readContract||checkoutGuard?.key!=='bees.production.checkout.v6'||typeof issuer!=='string'||!/^https:\/\/[a-z0-9.-]+$/.test(issuer))fail('draft_only');
 function getAuth(){const a=getState();if(!a||a.verified!==true||a.current!==true||!Number.isSafeInteger(a.generation)||a.generation<0||typeof a.bearer!=='string'||a.bearer.length>16000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(a.bearer)||!Number.isFinite(a.expires_at))fail('session');
 const c=decode(a.bearer);if(!c||c.iss!==issuer+'/auth/v1'||c.role!=='authenticated'||!(c.aud==='authenticated'||Array.isArray(c.aud)&&c.aud.includes('authenticated'))||!uuid(c.sub)||!uuid(c.session_id)||a.actor_id!==c.sub||!Number.isSafeInteger(c.exp))fail('claims');
 const expires_at=Math.min(a.expires_at,c.exp*1000);if(expires_at<=now()+30000)fail('expired');
 return Object.freeze({environment:'production',current:true,actor_id:c.sub,session_id:c.session_id,generation:a.generation,bearer:a.bearer,expires_at});}
 async function refreshExisting(){const a=getAuth();await refresh();if(!same(a,getAuth()))fail('session_changed');}
 const reads=new Set(['ml40_api_list_registered_cards_v2','ml40_api_registered_card_activity_v2','ml40_api_directory_memo_read_v1','ml40_api_directory_checkout_snapshot_v1','ml40_api_scan_read_v1','ml40_api_scan_checkout_snapshot_v1']);
 async function dispatch(d){const a=getAuth();if(!reads.has(d.name)||d.bearer!==a.bearer)fail('read_only');const r=await sendRead({name:d.name,args:d.args,bearer:a.bearer});if(!same(a,getAuth()))fail('session_changed');return r;}
 const bridge=root.BeesR36Bridge.create({getAuth,refresh:refreshExisting,dispatch,storage,verify:root.BeesR33Production.receipt,withLock:lock,now,digest,checkoutGuard,authorize:()=>false});
 const controller=root.BeesR33Production.create({session:bridge.session,sendRead:bridge.read,readContract,cardHost});
 // Wrap returned capability: no new write or receipt recovery in this draft.
 const view=Object.freeze({clear:controller.clear,list:controller.list,async selectDirectory(row,store){const d=await controller.selectDirectory(row,store);return {...d,selection:Object.freeze({...d.selection,canWrite:false})};},selectScan:controller.selectScan,describe:controller.describe,get selection(){const s=controller.selection;return s?Object.freeze({...s,canWrite:false}):null;}});
 const guard=Object.freeze({session:bridge.session,blocked:()=>true,pending:bridge.pending,async confirm(){fail('not_enabled');},async write(){fail('not_enabled');},async recover(){fail('not_enabled');}});
 const operations=root.BeesR35Operations.create({controller:view,bridge:guard,clock,newId,digest,pointPolicy:()=>null});
 return Object.freeze({operations,session:bridge.session,clear:operations.clear,existingPending:bridge.legacyPending,writeEnabled:false});
}
root.BeesR36SessionBinding=Object.freeze({create,writeEnabled:false});})(globalThis);