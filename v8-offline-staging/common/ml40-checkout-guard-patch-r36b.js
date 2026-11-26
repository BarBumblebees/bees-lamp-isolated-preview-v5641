/* Exact saved checkout_guard.js anchor replacement, before shipping BOTH staff pages.
 * This is a source transform; does not run on production. */
(function(root){'use strict';
function patch(source){
 const old="if(read())return false;";
 if(typeof source!=='string'||source.split(old).length!==2||!source.includes("return locks.request(key,{mode:'exclusive'},()=>{"))throw Error('checkout_guard_source_mismatch');
 return source.replace(old,()=> "try{if(storage.getItem('shop-point-nfc.ml40.pending.v1')!==null)return false;}catch(_){return false;}\n   if(read())return false;");
}
root.BeesR36CheckoutPatch=Object.freeze({patch});})(globalThis);