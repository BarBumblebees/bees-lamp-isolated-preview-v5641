/* R34D1: isolated memo update and receipt recovery controller. No network/storage on its own.
 * Uses existing authorized directory API, existing R22 journal and same page lock.
 */
(function(root){'use strict';
const ids=['actor_id','member_id','card_id','store_id'];
const fail=x=>{throw Error(x);};
function normalize(raw){if(typeof raw!=='string')fail('memo_type');const note=raw.trim();if([...note].length>60||/[\x00-\x1f\x7f-\x9f]/u.test(note)||/[\ud800-\udfff]/u.test(note))fail('memo_invalid');return note;}
async function digest(note,subtle=root.crypto?.subtle){if(!subtle||typeof subtle.digest!=='function')fail('digest_unavailable');const bytes=new TextEncoder().encode(note);const hash=new Uint8Array(await subtle.digest('SHA-256',bytes));if(hash.length!==32)fail('digest_invalid');return Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');}
function create({transport,reader,journal,newId,api,subtle}){
 if(!transport||!reader||!journal||typeof newId!=='function'||!api)fail('dependencies');
 let busy=false;
 function selected(){const d=reader.selected,a=transport.current();if(!d||!a||a.environment!=='isolated'||d.environment!=='isolated'||d.actor_id!==a.actor_id||d.session_id!==a.session_id||d.generation!==a.generation||!transport.writeEnabled)fail('stale');return {...d,current:true,route:'directory'};}
 function same(s){try{const n=selected();return ['epoch','generation','session_id',...ids].every(k=>s[k]===n[k])&&s.memo_version===n.memo_version&&s.memo===n.memo;}catch{return false;}}
 function pending(){return journal.read();}
 function canSave(raw){try{const s=selected();return !busy&&!pending()&&Number.isInteger(s.memo_version)&&s.memo_version>=0&&s.memo_version<2147483647&&normalize(raw)!==s.memo;}catch{return false;}}
 async function exclusive(fn){if(busy)fail('busy');busy=true;try{return await fn();}finally{busy=false;}}
 async function save(raw){if(!canSave(raw))fail('not_ready');return exclusive(async()=>{
  const s=selected(),note=normalize(raw),note_sha256=await digest(note,subtle);
  if(!same(s)||pending())fail('stale');
  const e={environment:'isolated',...Object.fromEntries(ids.map(k=>[k,s[k]])),action:'memo',request_id:newId(),memo_version:s.memo_version,note_sha256};
  const d=api.request('memo_once',s,{...e,note});
  if(d.args.p_note!==note||d.args.p_expected_version!==e.memo_version||d.args.p_request_id!==e.request_id)fail('binding');
  journal.save(e);
  const receipt=await transport.rpc(d);
  if(!same(s)||!journal.release(e,receipt,selected()))fail('receipt_unknown');
  reader.clear();return receipt;
 });}
 async function recover(){return exclusive(async()=>{const s=selected(),e=pending();if(!e||e.action!=='memo'||!ids.every(k=>e[k]===s[k]))fail('pending_owner_or_action');
  const r=await transport.rpc(api.request('receipt',s,{request_id:e.request_id}));if(!same(s)||!journal.release(e,r,selected()))fail('receipt_unknown');reader.clear();return r;
 });}
 return Object.freeze({save,recover,canSave,pending});
}
root.BeesR34Memo=Object.freeze({create,normalize,digest});})(globalThis);