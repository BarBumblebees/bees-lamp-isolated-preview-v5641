(function(root){'use strict';
// Offline adapter: builds RPC descriptors ONLY. No network, no auth token, no storage.
const verify=(...args)=>root.BeesReceiptIsolatedR19.verify(...args);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const rev=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(x)&&BigInt(x)<=9223372036854775807n;
const fail=x=>{throw Error(x)};
const keys=['actor_id','member_id','card_id','store_id'];
function binding(c){if(!c||c.environment!=='isolated'||c.route!=='directory'||c.current!==true||!keys.every(k=>uuid(c[k]))||!int(c.epoch,0,Number.MAX_SAFE_INTEGER))fail('context');return c;}
function same(a,b){return !!a&&!!b&&keys.every(k=>a[k]===b[k])&&a.epoch===b.epoch&&b.current===true&&a.environment===b.environment&&a.route===b.route;}
function request(op,c,p={}){binding(c);const common={p_member_id:c.member_id,p_card_id:c.card_id,p_store_id:c.store_id};let args,name;
 const amounts=()=>{if(!int(p.total,1,100000000)||!int(p.redeem,0,p.total)||p.redeem%10)fail('amount');return {p_total:p.total,p_redeem:p.redeem};};
 const id=()=>{if(!uuid(p.request_id))fail('request_id');return p.request_id;};
 switch(op){
 case 'memo_read':args={p_card_id:c.card_id,p_store_id:c.store_id};break;
 case 'checkout_snapshot':args=common;break;
 case 'memo_once':if(!int(p.memo_version,0,2147483646)||typeof p.note!=='string'||[...p.note].length>60||/[\x00-\x1f\x7f-\x9f]/u.test(p.note)||p.note!==p.note.trim())fail('memo');args={...common,p_request_id:id(),p_expected_version:p.memo_version,p_note:p.note};break;
 case 'point_once':if(!['visit','encounter'].includes(p.action)||!int(p.delta,1,2147483647)||(p.action==='encounter'&&p.delta!==1))fail('point');args={...common,p_request_id:id(),p_action:p.action,p_expected_delta:p.delta};break;
 case 'checkout_confirm':if(!int(p.before,0,10000000)||p.redeem>p.before||!rev(p.revision))fail('preview');args={...common,...amounts(),p_expected_balance:p.before,p_expected_revision:p.revision};break;
 case 'checkout_once':if(!uuid(p.confirmation_id))fail('confirmation');args={...common,...amounts(),p_request_id:id(),p_confirmation_id:p.confirmation_id};break;
 case 'receipt':name='ml40_operation_receipt_v1';args={p_request_id:id()};break;
 default:fail('operation');}
 return Object.freeze({name:name||'ml40_api_directory_'+op+'_v1',args:Object.freeze(args),sendEnabled:false});
}
function snapshot(op,d,expected,current){binding(expected);binding(current);if(!same(expected,current)||!d||!['member_id','card_id','store_id'].every(k=>d[k]===expected[k]))fail('stale_or_binding');if(op==='checkout_snapshot'){if(!int(d.balance,0,10000000)||!rev(d.revision))fail('snapshot');return Object.freeze({balance:d.balance,revision:d.revision});}if(op==='memo_read'){if(typeof d.memo!=='string'||[...d.memo].length>60||!int(d.memo_version,0,2147483647))fail('memo');return Object.freeze({memo:d.memo,version:d.memo_version});}fail('operation');}
function receipt(expected,d,original,current){try{binding(original);binding(current);if(!same(original,current)||!expected||!keys.every(k=>expected[k]===original[k]))return {state:'unknown',releasePending:false};return verify(expected,d,{...expected,...current});}catch{return {state:'unknown',releasePending:false};}}
root.BeesDirectoryApiIsolatedR19=Object.freeze({request,snapshot,receipt,sendEnabled:false});
})(globalThis);
