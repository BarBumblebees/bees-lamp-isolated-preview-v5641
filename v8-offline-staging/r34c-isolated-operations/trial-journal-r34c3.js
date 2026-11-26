/* R34C3 one-trial completion journal. Shared R22 pending journal preserved. */
(function(root){'use strict';
const key='bees.ml40.r34c.checkout.completed.v1';
const fail=()=>{throw Error('trial_storage_invalid');};
function create(storage){
 const j=root.BeesPendingR22.create(storage);
 function completed(){const raw=storage.getItem(key);if(raw===null)return false;if(raw!=='verified')fail();return true;}
 function save(e){if(completed())fail();return j.save(e);}
 function release(e,r,ctx){
  const old=j.read();
  if(!old||JSON.stringify(old)!==JSON.stringify(root.BeesPendingR22.validate(e))||!ctx||ctx.current!==true||ctx.environment!=='isolated'||!['actor_id','member_id','card_id','store_id'].every(k=>ctx[k]===old[k])||!root.BeesReceiptIsolatedR19.verify(old,r,{...old,current:true}).releasePending)return false;
  // Mark before removing pending. A crash or failed removal leaves recovery possible.
  storage.setItem(key,'verified');if(!completed())fail();
  return j.release(e,r,ctx);
 }
 return Object.freeze({read:j.read,save,release,completed});
}
root.BeesR34TrialJournal=Object.freeze({create,key});})(globalThis);