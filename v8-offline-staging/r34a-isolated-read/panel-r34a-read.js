/* R34A isolated actual read-only panel. No production or write endpoints. */
(()=>{'use strict';
const $=id=>document.getElementById('r34-'+id),T=BeesR34ReadTransport;
const transport=T.create(),ctl=BeesR34Read.create({transport,contract:BeesProductionReadContract,scope:{card:T.card,member:T.member,store:T.store}});
let busy=false,rows=[];
function status(s){$('status').textContent=s;}
function clear(){ctl.clear();rows=[];$('rows').replaceChildren();$('list').hidden=true;$('detail').hidden=true;$('summary').textContent='';$('memo').value='';$('history').replaceChildren();}
function ui(){const a=!!transport.current();$('login').hidden=a;$('work').hidden=!a;for(const id of ['signin','logout','open','search'])$(id).disabled=busy;for(const b of $('rows').querySelectorAll('button'))b.disabled=busy;}
async function run(fn){if(busy)return;busy=true;ui();try{await fn();}catch{clear();status('照会を停止しました。ログイン・権限・通信状態をご確認ください。');}finally{busy=false;ui();}}
function render(){BeesMemberListView.render({rows:rows.map(r=>({member_no:r.cardNumber,nickname:r.name,row:r})),query:$('search').value,body:$('rows'),scroll:$('scroll'),status:$('count'),disabled:busy,onSelect:m=>void run(async()=>{const d=await ctl.select(m.row);$('list').hidden=true;$('detail').hidden=false;$('summary').textContent='No.'+d.card_number+'　'+d.name+' ／ '+d.balance+'pt';$('memo').value=d.memo;$('history').replaceChildren();for(const h of d.history){const p=document.createElement('p');p.textContent=h.kind+' '+h.delta+'pt ／ '+(h.store||'');$('history').append(p);}status('隔離DBの実照会完了。書込は無効です。');})});}
$('login').onsubmit=e=>{e.preventDefault();void run(async()=>{const p=$('password').value;$('password').value='';await transport.signIn(T.email,p);status('隔離アカウントで認証しました。会員一覧を開いてください。');});};
$('logout').onclick=()=>void run(async()=>{clear();await transport.logout();status('ログアウトしました。');});
$('open').onclick=()=>void run(async()=>{clear();rows=await ctl.list();$('search').value='';$('list').hidden=false;render();status('隔離DBから会員一覧を取得しました。');});
$('search').oninput=()=>{if(!busy&&!$('list').hidden)render();};
window.addEventListener('pagehide',()=>{transport.clear();clear();});document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
setInterval(()=>{if(!transport.current()&&!$('work').hidden){clear();status('ログイン期限が切れました。');}ui();},1000);ui();
})();