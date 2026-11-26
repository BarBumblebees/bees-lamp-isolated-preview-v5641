/* ML40 R10: browser/Node offline selection and checkout-confirmation validation. No network. */
(function(root){'use strict';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const rev=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(x)&&BigInt(x)<=9223372036854775807n;
const fail=()=>{throw Error('invalid or stale directory binding')};
const base=c=>!!c&&c.environment==='isolated'&&c.route==='directory'&&c.current===true&&uuid(c.actor_id)&&uuid(c.store_id)&&int(c.epoch,0,Number.MAX_SAFE_INTEGER);
const current=(a,b)=>base(a)&&base(b)&&a.actor_id===b.actor_id&&a.store_id===b.store_id&&a.epoch===b.epoch;
const cardNo=x=>x===null||(typeof x==='string'&&/^[0-9]{6}$/.test(x)&&x!=='000000');
const selected=(c,row)=>{if(!base(c)||!row||!uuid(row.cardId)||!cardNo(row.cardNumber)||row.revokedAt!==null||typeof row.name!=='string'||!row.name.trim()||!int(row.balance,0,10000000))fail();return Object.freeze({environment:'isolated',route:'directory',current:true,actor_id:c.actor_id,store_id:c.store_id,epoch:c.epoch,card_id:row.cardId,card_number:row.cardNumber,name:row.name,balance:row.balance});};
function selectionRequest(row,context){const s=selected(context,row);return Object.freeze({selection:s,request:Object.freeze({name:'ml40_api_directory_memo_read_v1',args:Object.freeze({p_card_id:s.card_id,p_store_id:s.store_id}),sendEnabled:false})});}
function acceptSelection(s,d,live,liveCardId){if(!current(s,live)||!uuid(s.card_id)||liveCardId!==s.card_id||!d||d.card_id!==s.card_id||d.store_id!==s.store_id||!uuid(d.member_id)||typeof d.memo!=='string'||[...d.memo].length>60||/[\x00-\x1f\x7f-\x9f]/u.test(d.memo)||!int(d.memo_version,0,2147483647))fail();return Object.freeze({...s,member_id:d.member_id,memo:d.memo,memo_version:d.memo_version});}
function acceptConfirmation(d,original,live,p,livePreview,now=Date.now()){
 if(!current(original,live)||!uuid(original.member_id)||!uuid(original.card_id)||original.member_id!==live.member_id||original.card_id!==live.card_id||!p||!livePreview||!['total','redeem','before','revision'].every(k=>p[k]===livePreview[k])||!int(p.total,1,100000000)||!int(p.redeem,0,p.total)||p.redeem%10||!int(p.before,0,10000000)||p.redeem>p.before||!rev(p.revision)||!d||d.environment!=='isolated'||d.status!=='issued'||!uuid(d.confirmation_id)||!['actor_id','member_id','card_id','store_id'].every(k=>d[k]===original[k])||d.total!==p.total||d.redeem!==p.redeem||d.balance_before!==p.before||d.revision_before!==p.revision||typeof d.expires_at!=='string'||!Number.isFinite(now))fail();
 const expires=Date.parse(d.expires_at);if(!Number.isFinite(expires)||expires<=now||expires-now>120000)fail();
 return Object.freeze({confirmation_id:d.confirmation_id,expires_at:d.expires_at,actor_id:original.actor_id,member_id:original.member_id,card_id:original.card_id,store_id:original.store_id,epoch:original.epoch,total:p.total,redeem:p.redeem,balance_before:p.before,revision_before:p.revision,sendEnabled:false});
}
const api=Object.freeze({selectionRequest,acceptSelection,acceptConfirmation,sendEnabled:false});if(typeof module==='object'&&module.exports)module.exports=api;else root.BeesSelectionIsolatedR19=api;
})(globalThis);
