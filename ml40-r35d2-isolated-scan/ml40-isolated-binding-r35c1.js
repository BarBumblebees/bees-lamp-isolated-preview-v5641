/* R35C1 isolated common-operation binding. Existing trial auth owner and receipt journal.
 * The existing fixture's write trials are complete. Real transport stays read/recover only.
 * No production credential, RPC prefix, or journal used by this binding. */
(function(root){'use strict';
const ids=['actor_id','member_id','card_id','store_id'];
const identity=['actor_id','session_id','generation','environment'];
const equal=(a,b,k)=>!!a&&!!b&&k.every(x=>a[x]===b[x]);
const fail=x=>{throw Error(x)};
const CHECKOUT_DONE='bees.ml40.r34c.checkout.completed.v1';
function create({transport,scope,storage,lock,clock,newId,digest,contract,api,selection,allowNewWrite=false}){
 if(allowNewWrite!==false||!transport||!scope||!storage||!contract||!api||!selection||![lock,clock,newId,digest].every(x=>typeof x==='function'))fail('isolated_read_recover_only');
 const reader=root.BeesR34Read.create({transport,contract,scope}),journal=root.BeesPendingR22.create(storage);let scanSelection=null,scanEpoch=0;
 const session=()=>{const a=transport.current();return a?.environment==='isolated'?Object.freeze({...a,current:true}):null;};
 const selected=()=>{const a=session();if(scanSelection)return equal(scanSelection,a,identity)?scanSelection:null;const d=reader.selected;return equal(d,a,identity)?Object.freeze({...d,current:true,route:'directory',canWrite:false}):null;};
 const controller=Object.freeze({
  clear(){scanEpoch++;scanSelection=null;reader.clear();},
  async list(query='',append=false){if(query!==''||append)fail('fixture_scope');scanEpoch++;scanSelection=null;return {rows:await reader.list(),hasMore:false,capability:{detail:true,write:false}};},
  async selectDirectory(row,store){if(store!==scope.store)fail('fixture_store');const d=await reader.select(row),s=selected();if(!s)fail('selection_changed');return Object.freeze({selection:s,snapshot:Object.freeze({balance:d.balance,revision:d.revision}),history:d.history});},
  async selectScan(raw,store){scanEpoch++;scanSelection=null;reader.clear();const g=scanEpoch,a=session(),match=root.BeesR35DScan.resolve(raw);if(!a||!match||store!==scope.store||typeof transport.scanRead!=='function')fail('scan_context');const d=await transport.scanRead(match.marker);if(g!==scanEpoch||!equal(a,session(),identity))fail('selection_changed');if(!d||d.environment!=='isolated'||d.status!=='active'||d.route!=='scan'||d.actor_id!==a.actor_id||d.session_id!==a.session_id||d.card_id!=='18400000-0000-4000-8000-000000000023'||d.member_id!=='18400000-0000-4000-8000-000000000013'||d.card_number!=='900103'||d.scan_write_enabled!==false||d.balance!==0)fail('scan_response');const x=contract.card(d);scanSelection=Object.freeze({...a,epoch:g,route:'scan',card_id:d.card_id,member_id:d.member_id,store_id:store,card_number:x.cardNumber,name:x.name,canWrite:false});return Object.freeze({status:'active',selection:scanSelection,snapshot:Object.freeze({balance:x.balance,revision:null}),history:x.history});},
  describe(op,p){const s=selected();if(!s)fail('selection_changed');return api.request(op,s,p);},
  get selection(){return selected();}
 });
 function pending(){const p=journal.read();return p?Object.freeze({...p,route:'directory'}):null;}
 function blocked(){return true;} // no new writes on the already-tested fixture
 async function recover(){
  const original=selected(),a=session();if(!original||original.route!=='directory'||!a)fail('selection_changed');
  return lock('bees.ml40.r22.isolated.writer',async()=>{
   const e=journal.read(),live=selected();if(!e||!equal(original,live,[...identity,...ids,'epoch'])||!equal(e,live,ids))fail('pending_owner');
   const d=await transport.rpc(api.request('receipt',live,{request_id:e.request_id}));
   const after=selected();if(!equal(live,after,[...identity,...ids,'epoch']))fail('selection_changed');
   if(!root.BeesReceiptIsolatedR19.verify(e,d,{...e,current:true}).releasePending)fail('receipt_unknown');
   // Preserve the earlier checkout trial's no-repeat marker before releasing a verified checkout.
   if(e.action==='checkout'){storage.setItem(CHECKOUT_DONE,'verified');if(storage.getItem(CHECKOUT_DONE)!=='verified')fail('storage_failed');}
   if(!journal.release(e,d,after))fail('receipt_unknown');return d;
  });
 }
 const bridge=Object.freeze({session,pending,blocked,recover,async confirm(){fail('new_write_disabled');},async write(){fail('new_write_disabled');}});
 const operations=root.BeesR35Operations.create({controller,bridge,clock,newId,digest,pointPolicy:()=>null,environment:'isolated',
  acceptConfirmation:(s,d,p,timing)=>{const a=selection.acceptConfirmation(d,s,s,p,p,timing);return {...p,confirmation_id:a.confirmation_id,deadline:a.deadline};}});
 return Object.freeze({operations,pending,session,signIn:(...a)=>transport.signIn(...a),logout:async()=>{operations.clear();await transport.logout();},clear:()=>{operations.clear();transport.clear();},newWritesEnabled:false});
}
root.BeesR35IsolatedBinding=Object.freeze({create,newWritesEnabled:false});})(globalThis);