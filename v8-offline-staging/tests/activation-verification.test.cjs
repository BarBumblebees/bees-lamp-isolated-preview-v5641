'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('v8-offline-staging/staff.html','utf8');
const start=src.indexOf("  if(!r||r.status!=='active'");
const end=src.indexOf("  pendingActivationToken=null;",start);
assert(start!==-1&&end>start,'Post-activation validation block must exist');
const validation=src.slice(start,end);
assert(validation.includes("staff_card_details_v3"),'Must re-read card');
assert(validation.includes("verified.member_id!==r.member_id"),'Must compare member identity');
assert(validation.includes("activationSession!==staffSessionVersion"),'Must guard changed session');
const run=async ({response,read,sessionChanged=false,cardChanged=false})=>{
 let pendingActivationToken=cardChanged?'new-card':'original-card';
 let staffSessionVersion=sessionChanged?2:1;
 let token='isolated-demo-auth',managementView='home';
 const activationSession=1,activationAuthToken='isolated-demo-auth',cardToken='original-card',r=response;
 let calls=0;
 const request=async()=>{calls++;if(typeof read==='function')return read(()=>{staffSessionVersion=2},()=>{pendingActivationToken='new-card'});if(read instanceof Error)throw read;return read};
 const fn=new Function('r','request','activationSession','staffSessionVersion','token','activationAuthToken','pendingActivationToken','cardToken','managementView',`return (async()=>{${validation}return {verified,calls:0};})()`);
 try{const value=await fn(r,request,activationSession,staffSessionVersion,token,activationAuthToken,pendingActivationToken,cardToken,managementView);return {ok:true,value,calls};}
 catch(e){return {ok:false,error:e.message,calls}}
};
(async()=>{
 const response={status:'active',member_id:'member-1',display_name:'テスト会員'};
 const valid={status:'active',member_id:'member-1',display_name:'テスト会員',balance:0};
 let x=await run({response,read:valid});assert(x.ok&&x.value?.verified?.member_id==='member-1'&&x.calls===1,'successful registration must re-read');
 x=await run({response,read:{...valid,member_id:'other'}});assert(!x.ok&&/一致しません/.test(x.error),'wrong member must fail');
 x=await run({response,read:{...valid,status:'prepared'}});assert(!x.ok,'inactive card must fail');
 x=await run({response,read:new Error('network unavailable')});assert(!x.ok&&/network unavailable/.test(x.error),'network error must fail closed');
 x=await run({response:{status:'active',member_id:'',display_name:'x'},read:valid});assert(!x.ok&&x.calls===0,'malformed activation result must not re-read');
 x=await run({response,read:valid,sessionChanged:true});assert(x.ok&&x.value===undefined,'changed session must ignore response');
 x=await run({response,read:valid,cardChanged:true});assert(x.ok&&x.value===undefined,'switched card must ignore response');
 x=await run({response,read:(changeSession)=>{changeSession();return valid}});assert(x.ok&&x.value===undefined,'session changed during re-read must be ignored');
 x=await run({response,read:(_,changeCard)=>{changeCard();return valid}});assert(x.ok&&x.value===undefined,'card changed during re-read must be ignored');
 console.log('PASS: 9 isolated post-activation verification cases');
})().catch(e=>{console.error(e);process.exitCode=1});
