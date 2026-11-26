/* R31 production contract candidate, offline only. Server enforcement required.
 * Do not use profile metadata or browser decisions as authorization. */
(function(root){'use strict';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const deny=()=>Object.freeze({list:false,detail:false,memo:false,visit:false,encounter:false,checkout:false,receipt:false});
function decide(c,s){
 const no=deny();
 if(!c||c.environment!=='production'||c.current!==true||c.active!==true||c.retired!==false||!uuid(c.actorId)||!uuid(c.sessionId)||!['staff','store_admin','super_admin'].includes(c.role))return no;
 const superAdmin=c.role==='super_admin',storeAdmin=c.role==='store_admin',assigned=uuid(c.defaultStoreId)&&c.defaultStoreActive===true;
 const list=superAdmin||storeAdmin&&assigned,grant=list&&(superAdmin||c.directoryGrant===true);
 const base={...no,list};
 if(!s||s.environment!==c.environment||s.actorId!==c.actorId||s.sessionId!==c.sessionId||s.current!==true||!uuid(s.memberId)||!uuid(s.cardId)||s.cardActive!==true||s.replaced!==false)return Object.freeze(base);
 const directory=s.route==='directory',scan=s.route==='nfc'||s.route==='qr';
 if(!directory&&!scan)return Object.freeze(base);
 const own=assigned&&s.issuedStoreId===c.defaultStoreId;
 if(directory&&(!list||(!superAdmin&&!own)))return Object.freeze(base);
 if(scan&&s.serverVerifiedCard!==true)return Object.freeze(base);
 const storeOk=uuid(s.operationStoreId)&&s.operationStoreActive===true&&(superAdmin||s.operationStoreId===c.defaultStoreId&&assigned);
 // Proposed conservative unified-screen policy: staff scan existing NFC/QR paths remain separate.
 // Cross-store scan write stays blocked in the candidate until legacy policy is reviewed.
 const point=directory?grant:scan;
 return Object.freeze({...base,detail:true,memo:directory&&grant,visit:point&&storeOk,encounter:point&&c.encounterEnabled===true&&(superAdmin||assigned),checkout:point&&storeOk,receipt:false});
}
function canRecover(c,p){return !!(c&&p&&c.environment==='production'&&p.environment===c.environment&&c.current===true&&c.active===true&&c.retired===false&&uuid(c.actorId)&&p.actorId===c.actorId&&uuid(p.requestId));}
root.BeesR31Policy=Object.freeze({decide,canRecover});})(globalThis);