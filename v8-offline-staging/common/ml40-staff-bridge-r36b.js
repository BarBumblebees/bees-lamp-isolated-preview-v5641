/* R33B: staff-shell transport and journal. Draft, dependency-injected; no live endpoint. */
(function(root){'use strict';
const KEY='shop-point-nfc.ml40.pending.v1',LEGACY='shop-point-nfc.checkout-pending.v5',LOCK='bees.production.checkout.v6';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const int=(x,a,b)=>Number.isSafeInteger(x)&&x>=a&&x<=b;
const rev=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(x)&&BigInt(x)<=9223372036854775807n;
const fail=x=>{throw Error(x)};
const ids=['actor_id','member_id','card_id','store_id','request_id'];
const extra={checkout:['total','redeem','before','revision','confirmation_id'],memo:['memo_version','note_sha256'],visit:['delta'],encounter:['delta']};
const equal=(a,b,ks)=>!!a&&!!b&&ks.every(k=>a[k]===b[k]);
function validate(e){
 if(!e||e.environment!=='production'||!['scan','directory'].includes(e.route)||!Object.hasOwn(extra,e.action)||!ids.every(k=>uuid(e[k])))fail('pending_invalid');
 const keys=['environment','route','action',...ids,...extra[e.action]];
 if(Object.keys(e).length!==keys.length||!keys.every(k=>Object.hasOwn(e,k)))fail('pending_invalid');
 if(e.action==='checkout'&&(!uuid(e.confirmation_id)||!int(e.total,1,100000000)||!int(e.redeem,0,e.total)||e.redeem%10||!int(e.before,e.redeem,10000000)||!rev(e.revision)||e.before-e.redeem+Math.floor((e.total-e.redeem)/100)*5>10000000))fail('pending_invalid');
 if(e.action==='memo'&&(e.route!=='directory'||!int(e.memo_version,0,2147483646)||typeof e.note_sha256!=='string'||!/^[a-f0-9]{64}$/.test(e.note_sha256)))fail('pending_invalid');
 if(['visit','encounter'].includes(e.action)&&(!int(e.delta,1,2147483647)||(e.action==='encounter'&&e.delta!==1)))fail('pending_invalid');
 return Object.freeze(Object.fromEntries(keys.map(k=>[k,e[k]])));
}
function journal(storage,verify,checkoutGuard){
 if(!checkoutGuard||checkoutGuard.key!==LOCK||typeof checkoutGuard.read!=='function')fail('checkout_guard_required');
 const read=()=>{const v=storage.getItem(KEY);return v===null?null:validate(JSON.parse(v));};
 const legacyPending=()=>checkoutGuard.read()!==null||storage.getItem(LOCK)!==null||storage.getItem(LEGACY)!==null;
 function blocked(){try{return legacyPending()||read()!==null;}catch{return true;}}
 function save(e){e=validate(e);if(blocked())fail('pending_or_storage');const raw=JSON.stringify(e);storage.setItem(KEY,raw);if(storage.getItem(KEY)!==raw)fail('storage_failed');return e;}
 function release(e,d,s){const old=read();if(!old||JSON.stringify(old)!==JSON.stringify(validate(e))||!verify(old,d,s))return false;storage.removeItem(KEY);if(storage.getItem(KEY)!==null)fail('storage_failed');return true;}
 return Object.freeze({read,save,release,legacyPending,blocked});
}
const readNames=new Set(['ml40_api_list_registered_cards_v2','ml40_api_registered_card_activity_v2','ml40_api_directory_memo_read_v1','ml40_api_directory_checkout_snapshot_v1','ml40_api_scan_read_v1','ml40_api_scan_checkout_snapshot_v1','ml40_operation_receipt_v1','ml40_api_scan_receipt_v1']);
const confirmNames=new Set(['ml40_api_directory_checkout_confirm_v1','ml40_api_scan_checkout_confirm_v1']);
const writeNames=new Set(['ml40_api_directory_checkout_once_v1','ml40_api_directory_memo_once_v1','ml40_api_directory_point_once_v1','ml40_api_scan_checkout_once_v1','ml40_api_scan_point_once_v1']);
const isSession=s=>s&&s.environment==='production'&&s.current===true&&uuid(s.actor_id)&&uuid(s.session_id)&&int(s.generation,0,Number.MAX_SAFE_INTEGER);
function create({getAuth,refresh,dispatch,storage,verify,withLock,now=()=>Date.now(),digest,checkoutGuard,authorize,allowLive=false}){
 if(allowLive!==false||![getAuth,refresh,dispatch,verify,withLock,now,authorize].every(x=>typeof x==='function')||!storage)fail('draft_only');
 const j=journal(storage,verify,checkoutGuard);let busy=false;
 function auth(){const a=getAuth();if(!isSession(a)||typeof a.bearer!=='string'||!a.bearer||!Number.isFinite(a.expires_at))fail('staff_session');return a;}
 function session(){try{const a=auth();return Object.freeze({environment:a.environment,current:true,actor_id:a.actor_id,session_id:a.session_id,generation:a.generation});}catch{return null;}}
 const sameSession=(a,b)=>equal(a,b,['environment','actor_id','session_id','generation']);
 async function transport(d,original,guard=()=>true){
  let a=auth();if(!sameSession(a,original))fail('session_changed');
  if(a.expires_at<=now()+90000){await refresh();a=auth();}
  if(!sameSession(a,original)||a.expires_at<=now()+10000)fail('session_changed');
  if(guard()!==true)fail('selection_changed');
  const data=await dispatch({name:d.name,args:d.args,bearer:a.bearer}); // exactly one dispatch; no automatic retry, including 401.
  if(!sameSession(auth(),original))fail('session_changed');
  return data;
 }
 function descriptor(d,set){if(!d||!set.has(d.name)||!d.args||typeof d.args!=='object'||Array.isArray(d.args))fail('rpc_denied');return Object.freeze({name:d.name,args:Object.freeze({...d.args})});}
 async function exclusive(fn){if(busy)fail('busy');busy=true;try{return await withLock(LOCK,fn);}finally{busy=false;}}
 async function read(d){d=descriptor(d,readNames);return transport(d,auth());}
 async function confirm(d,guard=()=>false){d=descriptor(d,confirmNames);const original=auth();return exclusive(async()=>{if(j.blocked())fail('pending_or_storage');return transport(d,original,()=>guard()===true&&!j.blocked()&&authorize(d,original)===true);});}
 async function write(d,e,guard=()=>false){
  d=descriptor(d,writeNames);e=validate(e);const a=auth(),p=d.args;
  if(e.actor_id!==a.actor_id||!ids.filter(k=>k!=='actor_id').every(k=>p['p_'+k]===e[k]))fail('binding');
  const operation=e.action==='checkout'?'checkout_once':e.action==='memo'?'memo_once':'point_once';
  if(d.name!=='ml40_api_'+e.route+'_'+operation+'_v1')fail('route');
  if(e.action==='checkout'&&(p.p_total!==e.total||p.p_redeem!==e.redeem||p.p_confirmation_id!==e.confirmation_id))fail('amount_binding');
  if(e.action==='memo'&&(typeof digest!=='function'||p.p_expected_version!==e.memo_version||typeof p.p_note!=='string'||[...p.p_note].length>60||/[\x00-\x1f\x7f-\x9f]/u.test(p.p_note)||/[\ud800-\udfff]/u.test(p.p_note)||p.p_note.trim()!==p.p_note))fail('memo_binding');
  if(['visit','encounter'].includes(e.action)&&(p.p_action!==e.action||p.p_expected_delta!==e.delta))fail('point_binding');
  return exclusive(async()=>{if(!sameSession(auth(),a)||j.blocked()||guard()!==true)fail('pending_or_session');if(e.action==='memo'&&await digest(p.p_note)!==e.note_sha256)fail('memo_digest');if(!sameSession(auth(),a)||j.blocked()||guard()!==true||authorize(d,a)!==true)fail('pending_or_session');j.save(e);const data=await transport(d,a,()=>guard()===true&&!j.legacyPending()&&authorize(d,a)===true);if(!j.release(e,data,session()))fail('receipt_unknown');return data;});
 }
 async function recover(){
  const a=auth();return exclusive(async()=>{const e=j.read();if(!e||e.actor_id!==a.actor_id)fail('pending_owner');const name=e.route==='scan'?'ml40_api_scan_receipt_v1':'ml40_operation_receipt_v1';const d=await transport({name,args:{p_request_id:e.request_id}},a);if(!j.release(e,d,session()))fail('receipt_unknown');return d;});
 }
 return Object.freeze({session,read,confirm,write,recover,blocked:j.blocked,pending:j.read,legacyPending:j.legacyPending,writeEnabled:false});
}
root.BeesR36Bridge=Object.freeze({create,journal,validate,KEY,LEGACY,LOCK,writeEnabled:false});})(globalThis);
