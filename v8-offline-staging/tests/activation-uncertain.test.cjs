'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('v8-offline-staging/staff.html','utf8');
const start=src.indexOf("byId('activateCard').addEventListener('click',async()=>{");
const end=src.indexOf("\n});",start);
assert(start>=0&&end>start,'activation handler found');
const body=src.slice(start+"byId('activateCard').addEventListener('click',async()=>{".length,end);
const callback=new Function('env',`with(env){return async()=>{${body}}}`);
async function scenario({writeResult,readResult,writeError,readError}={}){
 const controls={activateCard:{disabled:false},activateStatus:{textContent:''},lookupStatus:{textContent:''},activationBox:{classList:{add(x){this.hidden=true}},hidden:false},goToCardRegistration:{classList:{add(x){this.hidden=true}},hidden:false},newMemberName:{value:'テスト会員'},activationStore:{value:'store-1',selectedOptions:[{textContent:'架空店舗'}]},lookupResult:{classList:{remove(){}},textContent:''}};
 let pendingActivationToken='card-test',activationInProgress=false,operationBusy=false,token='fake',staffSessionVersion=1,managementView='home',selected=false,calls=[];
 const env={byId:id=>controls[id],get activationInProgress(){return activationInProgress},set activationInProgress(v){activationInProgress=v},operationBusy,token,get pendingActivationToken(){return pendingActivationToken},set pendingActivationToken(v){pendingActivationToken=v},staffSessionVersion,managementView,confirm:()=>true,selectMember:()=>{selected=true},request:async(url)=>{calls.push(url);if(url.includes('activate_card')){if(writeError)throw writeError;return writeResult??{status:'active',member_id:'m1',display_name:'テスト会員'}}if(readError)throw readError;return readResult??{status:'active',member_id:'m1',display_name:'テスト会員',balance:0}}};
 await callback(env)();
 return {controls,pendingActivationToken,selected,calls};
}
(async()=>{
 let x=await scenario();assert(x.selected&&x.calls.length===2,'normal path selects after read');
 x=await scenario({writeError:new Error('timeout')});assert(!x.selected&&x.pendingActivationToken===null&&x.controls.activateCard.disabled&&x.controls.activationBox.classList.hidden&&/読み直してください/.test(x.controls.lookupStatus.textContent),'uncertain write must lock registration');
 x=await scenario({readError:new Error('timeout')});assert(!x.selected&&x.pendingActivationToken===null&&x.controls.activateCard.disabled&&/読み直してください/.test(x.controls.lookupStatus.textContent),'uncertain read must lock registration');
 x=await scenario({readResult:{status:'active',member_id:'wrong',display_name:'別人',balance:0}});assert(!x.selected&&x.pendingActivationToken===null&&x.controls.activateCard.disabled,'identity mismatch must lock registration');
 console.log('PASS: 4 actual activation handler scenarios');
})().catch(e=>{console.error(e);process.exitCode=1});
