/* R33C: embedded offline-only staff panel. Explicit mock session, no existing login token read. */
(()=>{'use strict';const $=id=>document.getElementById('ml40c-'+id),P=BeesR33Production,B=BeesR33Bridge;
if(!$('panel')||!globalThis.BeesR33OfflineFixture||!P||!B)return;
const f=BeesR33OfflineFixture.create(),bridge=B.create({getAuth:f.auth,refresh:async()=>{},dispatch:f.dispatch,storage:f.storage,verify:P.receipt,withLock:async(_name,fn)=>fn()});
const ctl=P.create({session:bridge.session,sendRead:bridge.read,readContract:BeesProductionReadContract,cardHost:f.cardHost});
let busy=false,rows=[],selected=null,snap=null,approval=null,opened=false;
function status(s){$('status').textContent=s;}
function store(){return f.stores.find(s=>s.id===$('store').value);}
function clear(){ctl.clear();selected=snap=approval=null;rows=[];$('list').hidden=true;$('detail').hidden=true;$('summary').textContent='';$('history').replaceChildren();$('approval').textContent='';$('total').value='';$('redeem').value='0';}
function preview(){const total=Number($('total').value),redeem=Number($('redeem').value);if(!snap||!$('total').value||!$('redeem').value||!Number.isSafeInteger(total)||total<1||total>100000000||!Number.isSafeInteger(redeem)||redeem<0||redeem%10||redeem>total||redeem>snap.balance)return null;return {total,redeem,before:snap.balance,revision:snap.revision};}
function ui(){const pending=bridge.blocked(),write=!!selected&&selected.canWrite&&!busy&&!pending;for(const id of ['nfc','qr','toggle','store','close','search'])$(id).disabled=busy;for(const b of $('rows').querySelectorAll('button'))b.disabled=busy;for(const id of ['visit','encounter','total','redeem'])$(id).disabled=!write;$('confirm').disabled=!write||!preview();$('commit').disabled=!write||!approval||approval.deadline<=performance.now();$('recover').hidden=!pending;$('recover').disabled=busy;$('loss').disabled=busy||pending;$('visit').textContent='来店ポイント +'+store().visit+'pt';}
function render(){BeesMemberListView.render({rows:rows.map(r=>({member_no:r.cardNumber,nickname:r.name,row:r})),query:$('search').value,body:$('rows'),scroll:$('scroll'),status:$('count'),disabled:busy,onSelect:m=>void run(async()=>{const d=await ctl.selectDirectory(m.row,store().id);show(d);})});}
function show(d){selected=d.selection;snap=d.snapshot;approval=null;rows=[];$('list').hidden=true;$('detail').hidden=false;$('summary').textContent='No.'+selected.card_number+'　'+selected.name+' ／ '+snap.balance+'pt';$('memo').value=selected.memo||'';$('history').replaceChildren();for(const h of d.history){const p=document.createElement('p');p.textContent=h.kind+' '+h.delta+'pt ／ '+(h.store||'');$('history').append(p);}$('approval').textContent='';status(selected.canWrite?'架空会員の照会完了。模擬操作ができます。':'模擬カード照会完了。読取経由の書込は無効です。');}
async function run(fn){if(busy||!opened)return;busy=true;ui();try{await fn()}catch{status(bridge.blocked()?'模擬受付が未照合です。再操作せず受付を照合してください。':'模擬操作を停止しました。選び直してください。');}finally{busy=false;ui();}}
$('store').replaceChildren(...f.stores.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));
$('open').onclick=()=>{opened=true;clear();$('panel').hidden=false;status('架空会員120名。実際のログイン・DB・カードは使いません。');ui();};
$('close').onclick=()=>{if(busy)return;clear();opened=false;$('panel').hidden=true;};
$('store').onchange=()=>{clear();status('操作店舗を変更しました。会員を選び直してください。');ui();};
$('toggle').onclick=()=>void run(async()=>{if(!$('list').hidden){clear();return;}clear();let l=await ctl.list();while(l.hasMore)l=await ctl.list('',true);rows=l.rows;$('list').hidden=false;$('search').value='';render();status('会員を選択してください。');});
$('search').oninput=()=>{if(!busy&&!$('list').hidden)render();};
for(const id of ['nfc','qr'])$(id).onclick=()=>void run(async()=>{clear();const d=await ctl.selectScan(f.fakeUrl,store().id);if(d.status!=='active')throw Error('fixture');show(d);});
for(const id of ['total','redeem'])$(id).oninput=()=>{approval=null;$('approval').textContent='';ui();};
$('confirm').onclick=()=>void run(async()=>{const p=preview(),s=selected;if(!p||!s?.canWrite||bridge.blocked())return;const start=performance.now(),d=await bridge.confirm(ctl.describe('checkout_confirm',p));approval=P.confirmation(s,d,p,{start,end:performance.now()});$('approval').textContent='支払 '+(p.total-p.redeem)+'円 ／ 付与 '+Math.floor((p.total-p.redeem)/100)*5+'pt';status('架空会計の確認完了。');});
function intent(action,extra){const s=selected;return {environment:'production',route:s.route,actor_id:s.actor_id,member_id:s.member_id,card_id:s.card_id,store_id:s.store_id,action,request_id:f.nextId(),...extra};}
async function write(action){if(!selected?.canWrite||bridge.blocked())return;let e,d;if(action==='checkout'){const p=preview(),a=approval;if(!p||!a||a.deadline<=performance.now()||!['total','redeem','before','revision'].every(k=>p[k]===a[k]))return;e=intent(action,{...p,confirmation_id:a.confirmation_id});d=ctl.describe('checkout_once',e);}else{e=intent(action,{delta:action==='visit'?store().visit:1});d=ctl.describe('point_once',e);}approval=null;if($('loss').checked){f.loseNext();$('loss').checked=false;}const r=await bridge.write(d,e);clear();status('模擬操作確定・受付照合済み。残高 '+(r.result.balance_after??r.result.balance)+'pt。');}
for(const [id,a] of [['commit','checkout'],['visit','visit'],['encounter','encounter']])$(id).onclick=()=>void run(()=>write(a));
$('recover').onclick=()=>void run(async()=>{const r=await bridge.recover();clear();status('模擬受付復旧完了。残高 '+(r.result.balance_after??r.result.balance)+'pt。');});
window.addEventListener('pagehide',()=>{f.invalidate();clear();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();ui();}});ui();
})();
