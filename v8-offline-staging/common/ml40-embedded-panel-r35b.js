/* R35B offline staff panel; simulated existing staff session, never uses live staff credentials. */
(()=>{'use strict';
const $=id=>document.getElementById('ml40c-'+id),P=BeesR33Production,M=BeesR34Memo;
if(!$('panel'))return;
const digest=n=>M.digest(n,crypto.subtle),f=BeesR35OfflineFixture.create({digest}),issuer='https://ml40-offline.invalid',mockBearer='mock.payload.signature';
const adapter=BeesR35StaffAdapter.create({getState:()=>{const a=f.auth();return {...a,verified:true,bearer:mockBearer};},decode:()=>{const a=f.auth();return {iss:issuer+'/auth/v1',sub:a.actor_id,session_id:a.session_id,aud:'authenticated',role:'authenticated',exp:Math.floor(a.expires_at/1000)};},issuer,refresh:async()=>{},send:d=>{if(d.bearer!==mockBearer)throw Error('offline_only');return f.dispatch({...d,bearer:'offline-fixture-not-a-token'});},storage:f.storage,lock:async(_name,fn)=>fn(),verify:P.receipt,digest});
const bridge=adapter.bridge,ctl=P.create({session:adapter.session,sendRead:bridge.read,readContract:BeesProductionReadContract,cardHost:f.cardHost});
const op=BeesR35Operations.create({controller:ctl,bridge,clock:()=>performance.now(),newId:f.nextId,digest,pointPolicy:(s,a)=>a==='encounter'?1:f.stores.find(x=>x.id===s.store_id)?.visit});
let opened=false,busy=false,rows=[];
const status=s=>{$('status').textContent=s;},store=()=>f.stores.find(s=>s.id===$('store').value);
function clear(){op.clear();rows=[];$('rows').replaceChildren();$('list').hidden=true;$('detail').hidden=true;$('summary').textContent='';$('history').replaceChildren();$('approval').textContent='';$('memo').value='';$('total').value='';$('redeem').value='0';}
function amounts(){if(!$('total').value||!$('redeem').value)return null;return [Number($('total').value),Number($('redeem').value)];}
function ui(){const x=op.state,s=x?.selection,p=amounts(),pending=bridge.blocked(),write=!!s?.canWrite&&!pending&&!busy;
 for(const id of ['open','close','store','nfc','qr','toggle','search'])$(id).disabled=busy;
 for(const b of $('rows').querySelectorAll('button'))b.disabled=busy;
 for(const id of ['visit','encounter','total','redeem','memo'])$(id).disabled=!write;
 let noteOk=false;try{noteOk=M.normalize($('memo').value)!==s?.memo;}catch{}
 $('memo-save').disabled=!write||!noteOk;
 $('confirm').disabled=!write||!p||!Number.isSafeInteger(p[0])||p[0]<1||p[0]>100000000||!Number.isSafeInteger(p[1])||p[1]<0||p[1]%10!==0||p[1]>Math.min(p[0],x?.snapshot.balance??0);
 $('commit').disabled=!write||!p||!op.canCommit(...p);
 let e=null;try{e=bridge.pending();}catch{}
 $('recover').hidden=!pending;$('recover').disabled=busy||!s||!e||e.route!==s.route||!['actor_id','card_id','member_id','store_id'].every(k=>e[k]===s[k]);
 $('loss').disabled=busy||pending;$('visit').textContent='来店ポイント +'+store().visit+'pt';
}
async function run(fn){if(busy||!opened)return;busy=true;ui();try{await fn();}catch{op.invalidateApproval();$('approval').textContent='';status(bridge.blocked()?'模擬受付が未照合です。同じ会員・店舗を選んで受付を照合してください。':'模擬操作を停止しました。会員を選び直してください。');}finally{busy=false;ui();}}
function show(d){const s=d.selection;rows=[];$('list').hidden=true;$('detail').hidden=false;$('summary').textContent='No.'+s.card_number+'　'+s.name+' ／ '+d.snapshot.balance+'pt';$('memo').value=s.memo||'';$('approval').textContent='';$('history').replaceChildren();for(const h of d.history){const p=document.createElement('p');p.textContent=h.kind+' '+h.delta+'pt ／ '+(h.store||'');$('history').append(p);}status(s.canWrite?'架空会員の照会完了。模擬操作ができます。':'模擬カード照会完了。読取経由の書込は無効です。');}
function render(){BeesMemberListView.render({rows:rows.map(r=>({member_no:r.cardNumber,nickname:r.name,row:r})),query:$('search').value,body:$('rows'),scroll:$('scroll'),status:$('count'),disabled:busy,onSelect:m=>void run(async()=>show(await op.selectDirectory(m.row,store().id)))});}
$('store').replaceChildren(...f.stores.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));
$('open').onclick=()=>{if(opened||busy)return;opened=true;clear();$('panel').hidden=false;status('架空会員120名・模擬認証。実カード・本番DBは使用しません。');ui();};
$('close').onclick=()=>{if(busy)return;clear();opened=false;$('panel').hidden=true;};
$('store').onchange=()=>{clear();status('操作店舗を変更しました。会員を選び直してください。');ui();};
$('toggle').onclick=()=>void run(async()=>{if(!$('list').hidden){clear();return;}clear();let l=await op.list();while(l.hasMore)l=await op.list('',true);rows=l.rows;$('list').hidden=false;$('search').value='';render();status('会員を選択してください。');});
$('search').oninput=()=>{if(!busy&&!$('list').hidden)render();};
for(const id of ['nfc','qr'])$(id).onclick=()=>void run(async()=>{clear();const d=await op.selectScan(f.fakeUrl,store().id);if(d.status!=='active')throw Error('fixture');show(d);});
for(const id of ['total','redeem'])$(id).oninput=()=>{op.invalidateApproval();$('approval').textContent='';ui();};
$('memo').oninput=ui;
$('confirm').onclick=()=>void run(async()=>{const p=amounts();if(!p)return;await op.confirm(...p);$('approval').textContent='支払 '+(p[0]-p[1])+'円 ／ 付与 '+Math.floor((p[0]-p[1])/100)*5+'pt';status('架空会計の確認完了。');});
function loss(){if($('loss').checked){f.loseNext();$('loss').checked=false;}}
function result(r){clear();status(r.action==='memo'?'模擬メモ保存・受付照合済み。メモ版 '+r.result.memo_version+'。':'模擬操作確定・受付照合済み。残高 '+(r.result.balance_after??r.result.balance)+'pt。');}
$('commit').onclick=()=>void run(async()=>{const p=amounts();if(!p)return;loss();result(await op.commit(...p));});
$('memo-save').onclick=()=>void run(async()=>{loss();result(await op.memo($('memo').value));});
for(const a of ['visit','encounter'])$(a).onclick=()=>void run(async()=>{loss();result(await op.point(a));});
$('recover').onclick=()=>void run(async()=>{const r=await op.recover();clear();status('模擬受付復旧完了。'+(r.action==='memo'?'メモ版 '+r.result.memo_version+'。':'残高 '+(r.result.balance_after??r.result.balance)+'pt。'));});
window.addEventListener('pagehide',()=>{f.invalidate();clear();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();ui();}});setInterval(()=>{if(opened&&!busy)ui();},1000);ui();
})();