/* R34C: isolated checkout and recovery. Requires R22 journal and exclusive page lock. */
(function(root){'use strict';
const ids=['actor_id','member_id','card_id','store_id'];
const fail=x=>{throw Error(x);};
function create({transport,reader,journal,clock,newId,api,selection}){
 let approval=null,busy=false;
 const selected=()=>{const d=reader.selected,a=transport.current();if(!d||!a||!transport.writeEnabled||a.environment!=='isolated'||d.actor_id!==a.actor_id||d.session_id!==a.session_id||d.generation!==a.generation)fail('stale');return {...d,current:true,route:'directory'};};
 function same(s){try{const n=selected();return ['epoch','generation','session_id',...ids].every(k=>s[k]===n[k]);}catch{return false;}}
 const intent=s=>({total:210,redeem:10,before:s.balance,revision:s.revision});
 const pending=()=>journal.read();
 function clear(){approval=null;}
 async function exclusive(fn){if(busy)fail('busy');busy=true;try{return await fn();}finally{busy=false;}}
 async function confirm(){return exclusive(async()=>{clear();if(pending())fail('pending');const s=selected(),p=intent(s),start=clock();const d=await transport.rpc(api.request('checkout_confirm',s,p));if(!same(s))fail('stale');const a=selection.acceptConfirmation(d,s,selected(),p,intent(selected()),{start,end:clock()});approval=Object.freeze({...a,session_id:s.session_id,generation:s.generation});return approval;});}
 function canCommit(){try{const s=selected(),a=approval;return !!a&&!busy&&!pending()&&same(a)&&a.balance_before===s.balance&&a.revision_before===s.revision&&a.deadline>clock();}catch{return false;}}
 async function commit(){if(!canCommit())fail('not_confirmed');return exclusive(async()=>{const s=selected(),a=approval,p=intent(s);clear();const e={environment:'isolated',...Object.fromEntries(ids.map(k=>[k,s[k]])),action:'checkout',request_id:newId(),...p,confirmation_id:a.confirmation_id};const d=api.request('checkout_once',s,e);if(!same(s)||pending())fail('stale');journal.save(e);const receipt=await transport.rpc(d);if(!same(s)||!journal.release(e,receipt,selected()))fail('receipt_unknown');reader.clear();return receipt;});}
 async function recover(){return exclusive(async()=>{clear();const s=selected(),e=pending();if(!e||!ids.every(k=>e[k]===s[k]))fail('pending_owner');const r=await transport.rpc(api.request('receipt',s,{request_id:e.request_id}));if(!same(s)||!journal.release(e,r,selected()))fail('receipt_unknown');reader.clear();return r;});}
 return Object.freeze({confirm,commit,recover,clear,pending,canCommit});
}
root.BeesR34Checkout=Object.freeze({create});})(globalThis);