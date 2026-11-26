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
 const reader=root.BeesR34Read.create({transport,contract,scope}),journal=root.BeesPendingR22.create(storage);
 const session=()=>{const a=transport.current();return a?.environment==='isolated'?Object.freeze({...a,current:true}):null;};
 const selected=()=>{const d=reader.selected,a=session();return equal(d,a,identity)?Object.freeze({...d,current:true,route:'directory',canWrite:false}):null;};
 const controller=Object.freeze({
  clear:reader.clear,
  async list(query='',append=false){if(query!==''||append)fail('fixture_scope');return {rows:await reader.list(),hasMore:false,capability:{detail:true,write:false}};},
  async selectDirectory(row,store){if(store!==scope.store)fail('fixture_store');const d=await reader.select(row),s=selected();if(!s)fail('selection_changed');return Object.freeze({selection:s,snapshot:Object.freeze({balance:d.balance,revision:d.revision}),history:d.history});},
  async selectScan(){fail('actual_scan_not_connected');},
  describe(op,p){const s=selected();if(!s)fail('selection_changed');return api.request(op,s,p);},
  get selection(){return selected();}
 });
 function pending(){const p=journal.read();return p?Object.freeze({...p,route:'directory'}):null;}
 function blocked(){return true;} // no new writes on the already-tested fixture
 async function recover(){
  const original=selected(),a=session();if(!original||!a)fail('selection_changed');
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