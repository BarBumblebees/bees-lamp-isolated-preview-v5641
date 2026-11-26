/* R33A: production API route controller, offline draft. No direct network or storage. */
(function(root){'use strict';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const int=(x,a,b)=>Number.isSafeInteger(x)&&x>=a&&x<=b;
const rev=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(x)&&BigInt(x)<=9223372036854775807n;
const fail=()=>{throw Error('invalid or stale operation context');};
const ids=['actor_id','member_id','card_id','store_id'];
const same=(a,b,keys)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
const balance=x=>int(x,0,10000000);
const base=s=>!!s&&s.environment==='production'&&s.current===true&&uuid(s.actor_id)&&uuid(s.session_id)&&int(s.generation,0,Number.MAX_SAFE_INTEGER);
const bound=s=>base(s)&&['directory','scan'].includes(s.route)&&uuid(s.member_id)&&uuid(s.card_id)&&uuid(s.store_id);
const amount=p=>p&&int(p.total,1,100000000)&&int(p.redeem,0,p.total)&&p.redeem%10===0;
const preview=p=>amount(p)&&balance(p.before)&&p.redeem<=p.before&&rev(p.revision)&&balance(p.before-p.redeem+Math.floor((p.total-p.redeem)/100)*5);
function scanToken(raw,host){
 if(typeof raw!=='string'||typeof host!=='string'||!/^[a-z0-9.-]+$/.test(host))return null;
 const s=raw.trim();if(s.length>512)return null;
 const m=s.match(/^(?:https:\/\/)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\/(?:index\.html)?#card=([A-Za-z0-9_-]{43})$/i);
 if(!m)return null;const h=m[1].toLowerCase();
 if(h.split('.').some(l=>!l||l.length>63||l.startsWith('-')||l.endsWith('-'))||!(h===host||h.endsWith('.'+host)))return null;
 return m[2];
}
const req=(name,args)=>Object.freeze({name,args:Object.freeze(args)});
function request(op,s,p={},credential=null){
 if(!bound(s))fail();const common={p_member_id:s.member_id,p_card_id:s.card_id,p_store_id:s.store_id},scan=s.route==='scan';
 const a=()=>{if(!amount(p))fail();return {p_total:p.total,p_redeem:p.redeem};};
 const rid=()=>{if(!uuid(p.request_id))fail();return p.request_id;};let args;
 switch(op){
 case 'receipt':return req(scan?'ml40_api_scan_receipt_v1':'ml40_operation_receipt_v1',{p_request_id:rid()});
 case 'memo_read':if(scan)fail();args={p_card_id:s.card_id,p_store_id:s.store_id};break;
 case 'memo_once':if(scan||!int(p.memo_version,0,2147483646)||typeof p.note!=='string'||[...p.note].length>60||/[\x00-\x1f\x7f-\x9f]/u.test(p.note)||p.note!==p.note.trim())fail();args={...common,p_request_id:rid(),p_expected_version:p.memo_version,p_note:p.note};break;
 case 'checkout_snapshot':args=common;break;
 case 'checkout_confirm':if(!preview(p))fail();args={...common,...a(),p_expected_balance:p.before,p_expected_revision:p.revision};break;
 case 'checkout_once':if(!uuid(p.confirmation_id))fail();args={...common,...a(),p_request_id:rid(),p_confirmation_id:p.confirmation_id};break;
 case 'point_once':if(!['visit','encounter'].includes(p.action)||!int(p.delta,1,2147483647)||(p.action==='encounter'&&p.delta!==1))fail();args={...common,p_request_id:rid(),p_action:p.action,p_expected_delta:p.delta};break;
 default:fail();
 }if(scan){if(!token(credential))fail();args={...args,p_card_token:credential};}
 return req('ml40_api_'+s.route+'_'+op+'_v1',args);
}
function snapshot(s,d){if(!bound(s)||!same(s,d,['member_id','card_id','store_id'])||(s.route==='scan'&&d.route!=='scan')||!balance(d.balance)||!rev(d.revision))fail();return Object.freeze({balance:d.balance,revision:d.revision});}
function confirmation(s,d,p,timing){
 if(!bound(s)||!preview(p)||!d||d.environment!=='production'||d.status!=='issued'||(s.route==='scan'?d.route!=='scan':d.route!==undefined&&d.route!=='directory')||!same(s,d,ids)||!uuid(d.confirmation_id)||d.total!==p.total||d.redeem!==p.redeem||d.balance_before!==p.before||d.revision_before!==p.revision||!timing||!Number.isFinite(timing.start)||!Number.isFinite(timing.end)||timing.end<timing.start)fail();
 const ttl=Date.parse(d.expires_at)-Date.parse(d.server_now),deadline=timing.start+Math.min(ttl,115000);
 if(!Number.isFinite(ttl)||ttl<=0||ttl>120000||deadline<=timing.end)fail();
 return Object.freeze({...p,confirmation_id:d.confirmation_id,deadline});
}
function receipt(e,d,session){
 if(!base(session)||!e||e.environment!=='production'||!['scan','directory'].includes(e.route)||!ids.every(k=>uuid(e[k]))||!uuid(e.request_id)||e.actor_id!==session.actor_id||!d||d.environment!=='production'||d.status!=='confirmed'||!same(e,d,[...ids,'request_id','action'])||(e.route==='scan'?d.route!=='scan':d.route!==undefined&&d.route!=='directory'))return false;
 const r=d.result;if(!r||typeof r!=='object'||Array.isArray(r))return false;
 if(e.action==='checkout'){if(!preview(e)||!uuid(e.confirmation_id))return false;const paid=e.total-e.redeem,earned=Math.floor(paid/100)*5,after=e.before-e.redeem+earned,revisionAfter=(BigInt(e.revision)+BigInt((e.redeem>0?1:0)+(earned>0?1:0))).toString();return Object.entries({total:e.total,redeem:e.redeem,paid,earned,balance_before:e.before,delta:earned-e.redeem,balance_after:after,confirmation_id:e.confirmation_id,revision_before:e.revision,revision_after:revisionAfter}).every(([k,v])=>r[k]===v);}
 if(e.action==='memo')return e.route==='directory'&&int(e.memo_version,0,2147483646)&&typeof e.note_sha256==='string'&&/^[a-f0-9]{64}$/.test(e.note_sha256)&&r.memo_version===e.memo_version+1&&r.note_sha256===e.note_sha256;
 return ['visit','encounter'].includes(e.action)&&int(e.delta,1,2147483647)&&(e.action!=='encounter'||e.delta===1)&&uuid(r.transaction_id)&&balance(r.balance)&&r.delta===e.delta;
}
function create({session,sendRead,readContract,cardHost,allowLive=false}){
 if(typeof session!=='function'||typeof sendRead!=='function'||!readContract||allowLive!==false)fail();
 let epoch=0,selection=null,credential=null,capability=null,rows=[],offset=0,more=false,filter=null,listContext=null,inFlight=false;
 function current(){const s=session();if(!base(s))fail();return Object.freeze({environment:'production',current:true,actor_id:s.actor_id,session_id:s.session_id,generation:s.generation,epoch});}
 const keys=['actor_id','session_id','generation','epoch','environment'];
 function alive(s){try{return same(s,current(),keys);}catch{return false;}}
 function clear(){epoch++;selection=null;credential=null;capability=null;rows=[];offset=0;more=false;filter=null;listContext=null;}
 async function read(descriptor,s){if(!alive(s))fail();const d=await sendRead(descriptor);if(!alive(s))fail();return d;}
 function selected(){if(!selection||!alive(selection))fail();return selection;}
 async function guarded(fn){if(inFlight)fail();inFlight=true;try{return await fn();}finally{inFlight=false;}}
 async function list(query='',append=false){return guarded(async()=>{
 if(typeof query!=='string'||[...query].length>80)fail();
 if(!append){clear();filter=query;}else if(filter!==query||!more||!alive(listContext))fail();
 const s=current(),start=offset,d=await read(req('ml40_api_list_registered_cards_v2',{p_query:query,p_kind:'all',p_offset:start,p_status:'active'}),s);
 const parsed=readContract.directory(d,'active');if(!d.capabilities||typeof d.capabilities.write!=='boolean'||typeof d.capabilities.detail!=='boolean'||(d.capabilities.write&&!d.capabilities.detail))fail();
 if(append&&(!capability||capability.write!==d.capabilities.write||capability.detail!==d.capabilities.detail))fail();
 const seen=new Set(rows.map(r=>r.cardId));if(parsed.cards.some(r=>seen.has(r.cardId)))fail();
 listContext=s;rows=[...rows,...parsed.cards];offset+=parsed.cards.length;more=parsed.hasMore;capability=Object.freeze({detail:d.capabilities.detail,write:d.capabilities.write});
 return Object.freeze({rows:Object.freeze([...rows]),hasMore:more,capability});});}
 async function selectDirectory(row,store){return guarded(async()=>{
 if(!uuid(store)||!rows.includes(row)||!capability?.detail||!alive(listContext))fail();
 const cap=capability;clear();const s=current();
 const m=await read(req('ml40_api_directory_memo_read_v1',{p_card_id:row.cardId,p_store_id:store}),s);
 if(!m||m.card_id!==row.cardId||m.store_id!==store||!uuid(m.member_id)||typeof m.memo!=='string'||[...m.memo].length>60||!int(m.memo_version,0,2147483647))fail();
 const x=Object.freeze({...s,route:'directory',member_id:m.member_id,card_id:row.cardId,store_id:store,name:row.name,card_number:row.cardNumber,memo:m.memo,memo_version:m.memo_version,canWrite:cap.write});
 const snap=snapshot(x,await read(request('checkout_snapshot',x),s));
 const history=readContract.activity(await read(req('ml40_api_registered_card_activity_v2',{p_card_id:row.cardId}),s));
 if(!alive(s))fail();selection=x;return Object.freeze({selection:x,snapshot:snap,history:history.history});});}
 async function selectScan(raw,store){return guarded(async()=>{
 if(!uuid(store))fail();clear();const s=current(),t=scanToken(raw,cardHost);if(!t)fail();
 const d=await read(req('ml40_api_scan_read_v1',{p_card_token:t}),s);
 if(!d||d.environment!=='production')fail();
 if(['unknown','revoked','prepared'].includes(d.status))return Object.freeze({status:d.status,card_number:d.status==='prepared'?d.card_number:null});
 if(d.status!=='active'||d.route!=='scan'||!same(s,d,['actor_id','session_id'])||!uuid(d.card_id)||!uuid(d.member_id)||d.scan_write_enabled!==false)fail();
 const parsed=readContract.card(d),x=Object.freeze({...s,route:'scan',member_id:d.member_id,card_id:d.card_id,store_id:store,name:parsed.name,card_number:parsed.cardNumber,canWrite:false});
 const snap=snapshot(x,await read(request('checkout_snapshot',x,{},t),s));
 if(!alive(s))fail();credential=t;selection=x;return Object.freeze({status:'active',selection:x,snapshot:snap,history:parsed.history});});}
 function describe(op,p){return request(op,selected(),p,credential);}
 return Object.freeze({clear,list,selectDirectory,selectScan,describe,get selection(){try{return selected();}catch{return null;}},writeEnabled:false});
}
root.BeesR33Production=Object.freeze({create,scanToken,request,snapshot,confirmation,receipt,writeEnabled:false});})(globalThis);
