/* R35C2 isolated integrated panel; actual test login, no new writes. */
(()=>{'use strict';
const $=id=>document.getElementById('r34-'+id),T=BeesR34ReadTransport;
let binding=null,op=null,busy=false,rows=[],fault=false,scanner=null,scanMode=null,scanEpoch=0;
const status=s=>{$('status').textContent=s;};
function stopScan(){scanEpoch++;scanMode=null;scanner?.stop();$('scan-file').value='';}
function clear(){stopScan();op?.clear();rows=[];$('rows').replaceChildren();$('list').hidden=true;$('detail').hidden=true;$('summary').textContent='';$('memo').value='';$('memo-label').hidden=true;$('history').replaceChildren();}
function ui(){const a=binding?.session(),s=op?.state?.selection;$('login').hidden=!!a;$('work').hidden=!a;$('signin').disabled=busy||fault||!binding;
 for(const id of ['logout','open','search','nfc','qr','scan-file'])$(id).disabled=busy||fault||!a;$('scan-stop').disabled=busy||!scanMode;
 for(const b of $('rows').querySelectorAll('button'))b.disabled=busy;
 let e=null;try{e=binding?.pending();}catch{fault=true;}
 $('pending').textContent=fault?'保存領域を確認できません。受付操作は停止しています。':e?'未照合受付があります。同じ会員を選択して照合してください。':'未照合受付なし。新規書込は無効です。';
 $('recover').hidden=!e;$('recover').disabled=busy||fault||!s||!e||!['actor_id','member_id','card_id','store_id','route'].every(k=>s[k]===e[k]);
 $('signin').disabled=busy||fault||!binding;
}
async function run(fn){if(busy||!binding||fault)return;busy=true;ui();try{await fn();}catch{clear();status('処理を停止しました。認証・権限・受付状態をご確認ください。');}finally{busy=false;ui();}}
function show(d){const s=d.selection;$('list').hidden=true;$('detail').hidden=false;$('summary').textContent='No.'+s.card_number+'　'+s.name+' ／ '+d.snapshot.balance+'pt';$('memo-label').hidden=s.route==='scan';$('memo').value=s.memo??'';$('history').replaceChildren();for(const h of d.history){const p=document.createElement('p');p.textContent=h.kind+' '+h.delta+'pt ／ '+(h.store||'');$('history').append(p);}status(s.route==='scan'?'試験カード読取・隔離DB実照会完了。書込は無効です。':'統合画面で隔離DB実照会完了。新規書込は無効です。');}
function render(){BeesMemberListView.render({rows:rows.map(r=>({member_no:r.cardNumber,nickname:r.name,row:r})),query:$('search').value,body:$('rows'),scroll:$('scroll'),status:$('count'),disabled:busy,onSelect:m=>void run(async()=>show(await op.selectDirectory(m.row,T.store)))});}
$('login').onsubmit=e=>{e.preventDefault();void run(async()=>{const p=$('password').value;$('password').value='';await binding.signIn(T.email,p);status('隔離スタッフ認証完了。');});};
$('logout').onclick=()=>void run(async()=>{clear();await binding.logout();status('ログアウトしました。');});
$('open').onclick=()=>void run(async()=>{clear();const d=await op.list();rows=d.rows;$('search').value='';$('list').hidden=false;render();status('会員一覧を取得しました。');});
$('search').oninput=()=>{if(!busy&&!$('list').hidden)render();};
function handleRead(match,mode){if(!match||!BeesR35DScan.resolve(BeesR35DScan.fixture)||match.marker!==BeesR35DScan.resolve(BeesR35DScan.fixture).marker||!scanMode||scanMode!==mode||!binding?.session()||document.hidden)return;stopScan();void run(async()=>{const d=await op.selectScan(BeesR35DScan.fixture,T.store);show(d);status('試験専用カード '+d.selection.card_number+' ／ '+(mode==='nfc'?'NFC':mode==='qr'?'QRカメラ':'QR画像')+'読取・隔離DB実照会完了。');});}
scanner=BeesR35DScan.create({video:$('video'),onCard:m=>{const mode=scanMode;if(mode==='nfc'||mode==='qr')handleRead(m,mode);},onStatus:s=>{if(scanMode){status(s);if(!scanner.active)scanMode=null;ui();}}});
for(const mode of ['nfc','qr'])$(mode).onclick=()=>{if(busy||fault||!binding?.session()||document.hidden)return;clear();scanMode=mode;status('読取を開始します。');ui();void (mode==='nfc'?scanner.startNfc():scanner.startQr());};
$('scan-stop').onclick=()=>{stopScan();status('読取を停止しました。');ui();};
$('scan-file').onchange=async()=>{const file=$('scan-file').files?.[0];if(!file||busy||fault||!binding?.session())return;clear();scanMode='file';const g=scanEpoch;status('QR画像を端末内で解析しています。');ui();let bitmap;try{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12000000||typeof createImageBitmap!=='function')throw Error('image');bitmap=await createImageBitmap(file);if(g!==scanEpoch||!binding?.session()||document.hidden)return;if(bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>40000000)throw Error('size');const canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const im=ctx.getImageData(0,0,canvas.width,canvas.height),q=jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'}),match=q&&BeesR35DScan.resolve(q.data);if(!match)throw Error('wrong_qr');handleRead(match,'file');}catch{if(g===scanEpoch){stopScan();status('試験専用QR画像を確認できません。');ui();}}finally{bitmap?.close();}};

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