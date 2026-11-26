/* R35C2 isolated integrated panel; actual test login, no new writes. */
(()=>{'use strict';
const $=id=>document.getElementById('r34-'+id),T=BeesR34ReadTransport;
let binding=null,op=null,busy=false,rows=[],fault=false;
const status=s=>{$('status').textContent=s;};
function clear(){op?.clear();rows=[];$('rows').replaceChildren();$('list').hidden=true;$('detail').hidden=true;$('summary').textContent='';$('memo').value='';$('history').replaceChildren();}
function ui(){const a=binding?.session(),s=op?.state?.selection;$('login').hidden=!!a;$('work').hidden=!a;$('signin').disabled=busy||fault||!binding;
 for(const id of ['logout','open','search'])$(id).disabled=busy;
 for(const b of $('rows').querySelectorAll('button'))b.disabled=busy;
 let e=null;try{e=binding?.pending();}catch{fault=true;}
 $('pending').textContent=fault?'保存領域を確認できません。受付操作は停止しています。':e?'未照合受付があります。同じ会員を選択して照合してください。':'未照合受付なし。新規書込は無効です。';
 $('recover').hidden=!e;$('recover').disabled=busy||fault||!s||!e||!['actor_id','member_id','card_id','store_id','route'].every(k=>s[k]===e[k]);
 $('signin').disabled=busy||fault||!binding;
}
async function run(fn){if(busy||!binding||fault)return;busy=true;ui();try{await fn();}catch{clear();status('処理を停止しました。認証・権限・受付状態をご確認ください。');}finally{busy=false;ui();}}
function show(d){const s=d.selection;$('list').hidden=true;$('detail').hidden=false;$('summary').textContent='No.'+s.card_number+'　'+s.name+' ／ '+d.snapshot.balance+'pt';$('memo').value=s.memo;$('history').replaceChildren();for(const h of d.history){const p=document.createElement('p');p.textContent=h.kind+' '+h.delta+'pt ／ '+(h.store||'');$('history').append(p);}status('統合画面で隔離DB実照会完了。新規書込は無効です。');}
function render(){BeesMemberListView.render({rows:rows.map(r=>({member_no:r.cardNumber,nickname:r.name,row:r})),query:$('search').value,body:$('rows'),scroll:$('scroll'),status:$('count'),disabled:busy,onSelect:m=>void run(async()=>show(await op.selectDirectory(m.row,T.store)))});}
$('login').onsubmit=e=>{e.preventDefault();void run(async()=>{const p=$('password').value;$('password').value='';await binding.signIn(T.email,p);status('隔離スタッフ認証完了。');});};
$('logout').onclick=()=>void run(async()=>{clear();await binding.logout();status('ログアウトしました。');});
$('open').onclick=()=>void run(async()=>{clear();const d=await op.list();rows=d.rows;$('search').value='';$('list').hidden=false;render();status('会員一覧を取得しました。');});
$('search').oninput=()=>{if(!busy&&!$('list').hidden)render();};
$('recover').onclick=()=>void run(async()=>{const r=await op.recover();clear();status('既存受付の照合完了。再操作していません。'+(r.action==='memo'?' メモ版 '+r.result.memo_version+'。':''));});
window.addEventListener('pagehide',()=>{binding?.clear();clear();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();ui();}});
try{if(!globalThis.isSecureContext||!navigator.locks||!crypto.subtle||!crypto.randomUUID)throw Error('secure_context');
 const storage=localStorage,probe='bees.ml40.r35c2.probe';storage.setItem(probe,'1');if(storage.getItem(probe)!=='1')throw Error('storage');storage.removeItem(probe);
 const lock=(name,fn)=>navigator.locks.request(name,{ifAvailable:true},async l=>{if(!l)throw Error('other_trial_active');return fn();});
 binding=BeesR35IsolatedBinding.create({transport:T.create(),scope:{card:T.card,member:T.member,store:T.store},storage,lock,clock:()=>performance.now(),newId:()=>crypto.randomUUID(),digest:n=>BeesR34Memo.digest(n,crypto.subtle),contract:BeesProductionReadContract,api:BeesDirectoryApiIsolatedR19,selection:BeesSelectionIsolatedR19});
 op=binding.operations;binding.pending();
}catch{fault=true;status('安全な認証・受付保存環境を確保できません。');}
setInterval(()=>{if(!binding?.session()&&!$('work').hidden){clear();status('ログイン期限が切れました。');}ui();},1000);ui();
})();