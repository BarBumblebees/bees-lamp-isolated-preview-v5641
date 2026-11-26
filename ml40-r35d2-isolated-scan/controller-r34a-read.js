/* R34A read-only screen controller. Real isolated fixture only; no production RPCs. */
(function(root){'use strict';
const fail=()=>{throw Error('read_context_invalid');};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const balance=x=>Number.isSafeInteger(x)&&x>=0&&x<=10000000;
const rev=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(x)&&BigInt(x)<=9223372036854775807n;
function create({transport,contract,scope}){
 if(!transport||typeof transport.current!=='function'||typeof transport.rpc!=='function'||!contract||!scope||!['card','member','store'].every(k=>uuid(scope[k])))fail();
 let epoch=0,rows=[],listContext=null,busy=false,selected=null;
 function context(){const s=transport.current();if(!s||s.environment!=='isolated'||!uuid(s.actor_id)||!uuid(s.session_id)||!Number.isSafeInteger(s.generation))fail();return {environment:'isolated',actor_id:s.actor_id,session_id:s.session_id,generation:s.generation,epoch};}
 function live(s){try{const c=context();return Object.keys(c).every(k=>c[k]===s[k]);}catch{return false;}}
 function clear(){epoch++;rows=[];listContext=selected=null;}
 async function rpc(s,name,args){if(!live(s))fail();const r=await transport.rpc({name,args});if(!live(s))fail();return r;}
 async function guard(fn){if(busy)fail();busy=true;try{return await fn();}finally{busy=false;}}
 async function list(){return guard(async()=>{clear();const s=context(),r=await rpc(s,'list_registered_cards_v2',{p_query:'',p_kind:'all',p_offset:0,p_status:'active'}),d=contract.directory(r,'active');
 if(r.trial_capabilities?.detail!==true||r.trial_capabilities?.write!==true||d.scopeStoreName!=='ML40試験店舗A'||d.hasMore||d.cards.length!==1||d.cards[0].cardId!==scope.card||d.cards[0].cardNumber!=='900101')fail();
 rows=d.cards;listContext=s;return Object.freeze([...rows]);});}
 async function select(row){return guard(async()=>{if(!rows.includes(row)||!live(listContext))fail();clear();const s=context(),common={p_card_id:scope.card,p_store_id:scope.store};
 const m=await rpc(s,'ml40_api_directory_memo_read_v1',common);
 if(!m||m.card_id!==scope.card||m.member_id!==scope.member||m.store_id!==scope.store||typeof m.memo!=='string'||[...m.memo].length>60||!Number.isSafeInteger(m.memo_version)||m.memo_version<0)fail();
 const x=await rpc(s,'ml40_api_directory_checkout_snapshot_v1',{...common,p_member_id:scope.member});
 if(!x||x.member_id!==scope.member||x.card_id!==scope.card||x.store_id!==scope.store||!balance(x.balance)||!rev(x.revision))fail();
 const a=contract.activity(await rpc(s,'registered_card_activity_v2',{p_card_id:scope.card}));
 if(!live(s))fail();
 selected=Object.freeze({...s,card_id:scope.card,member_id:scope.member,store_id:scope.store,card_number:row.cardNumber,name:row.name,memo:m.memo,memo_version:m.memo_version,balance:x.balance,revision:x.revision,history:Object.freeze(a.history),canWrite:false});
 return selected;});}
 return Object.freeze({list,select,clear,get selected(){return selected&&live(selected)?selected:null;},writeEnabled:false});
}
root.BeesR34Read=Object.freeze({create,writeEnabled:false});})(globalThis);