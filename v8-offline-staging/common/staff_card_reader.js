(()=>{'use strict';
const BASE='https://cuoruflxfyubjpboqprb.supabase.co';
const KEY='sb_publishable_EdoSdDxZAEeXDKzuN9gVDg_ThW89nz8';
const STORAGE='shop-point-nfc.staff-session.v4';
const $=id=>document.getElementById(id);
let access=null,day=null,epoch=0,scanner=null,busy=false;
const isolated=(()=>{const meta=document.querySelector('meta[http-equiv="Content-Security-Policy"]');return !!meta&&/connect-src\s+'none'/.test(meta.content)})();
const jstDay=()=>new Date(Date.now()+3600000).toISOString().slice(0,10);
function clearMember(){ $('member').classList.add('hidden');$('name').textContent='';$('balance').textContent='';$('metadata').textContent='';$('history').replaceChildren() }
function stop(){if(scanner){scanner.stop();scanner=null}$('stop').disabled=true}
function reset(message){epoch++;stop();busy=false;access=null;day=null;clearMember();$('cardUrl').value='';$('start').disabled=true;$('lookup').disabled=true;$('authStatus').textContent=message;$('status').textContent='スタッフ認証が必要です。'}
function validCard(value){try{const raw=String(value||'').trim();const u=new URL(/^https:\/\//i.test(raw)?raw:'https://'+raw);if(u.protocol!=='https:'||!(u.hostname==='shop-point-nfc-customer-test-1107.pages.dev'||u.hostname.endsWith('.shop-point-nfc-customer-test-1107.pages.dev'))||u.port||u.username||u.password||u.search||!['/','/index.html'].includes(u.pathname))return null;const m=u.hash.match(/^#card=([A-Za-z0-9_-]{43})$/);return m?m[1]:null}catch(_){return null}}
async function api(path,body,bearer){const res=await fetch(BASE+path,{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});if(!res.ok)throw Error('スタッフ認証または会員照会に失敗しました ('+res.status+')');return res.json()}
async function authenticate(){
 reset('ログイン状態を確認しています…');
 if(isolated){$('authStatus').textContent='隔離環境では認証・実会員照会は利用できません。NFCカードURLの形式確認だけ可能です。';$('start').disabled=false;$('lookup').disabled=false;$('status').textContent='カードURLの形式確認ができます（会員照会はできません）。';return}
 let stored;try{stored=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch(_){}
 if(!stored||!stored.refresh_token||stored.business_day!==jstDay()){reset('通常のスタッフ画面でログインしてください。');return}
 const mine=epoch;
 try{
  // Reuse the verified staff access token without rotating the shared refresh token.
  // The original staff page remains the sole owner of session renewal.
  if(!stored.access_token||Number(stored.expires_at)<=Date.now()/1000+90)throw Error('スタッフ画面でログインし直してください');
  await api('/rest/v1/rpc/staff_card_stock_stores',{},stored.access_token);
  if(mine!==epoch)return;
  if(stored.business_day!==jstDay())throw Error('営業日が切り替わりました');
  access=stored.access_token;day=stored.business_day;
  $('authStatus').textContent='スタッフ権限を確認しました。';
  $('start').disabled=false;$('lookup').disabled=false;$('status').textContent='カードをかざしてください。';
 }catch(_){reset('認証を確認できません。通常のスタッフ画面で再ログインしてください。')}
}
function render(r){
 clearMember();$('name').textContent=r.display_name+' 様';$('balance').textContent='共通残高 '+Number(r.balance).toLocaleString('ja-JP')+'pt';
 $('metadata').textContent='カード No.'+(r.card_number||'未割当')+' ／ 発行店舗 '+(r.issued_store_name||'記録なし');
 const history=Array.isArray(r.history)?r.history:[];
 if(!history.length){const li=document.createElement('li');li.textContent='履歴がありません。';$('history').append(li)}
 for(const h of history){const li=document.createElement('li');const when=h.created_at?new Date(h.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'';li.textContent=(h.store||h.encounter_staff_name||'ポイント操作')+' ／ '+String(h.kind||'')+' ／ '+(Number(h.delta)>0?'+':'')+String(h.delta)+'pt '+when;$('history').append(li)}
 $('member').classList.remove('hidden');
}
async function lookup(raw){
 if(busy)return;
 clearMember();$('cardUrl').value='';
 if(!isolated&&(!access||day!==jstDay())){reset('営業日または認証が無効です。再ログインしてください。');return}
 const card=validCard(raw);if(!card){$('status').textContent='カードURLの形式を確認してください。';return}
 if(isolated){epoch++;stop();$('start').disabled=false;$('status').textContent='NFCカードURLの形式を確認しました。会員情報は照会していません。次のカードを読むには「カードを読み取る」を押してください。';return}
 const mine=++epoch;busy=true;$('lookup').disabled=true;$('start').disabled=true;$('status').textContent='会員照会中…';stop();
 // Session renewal belongs to the normal staff screen; never refresh or rotate its token here.
 let current;try{current=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch(_){}
 if(!current||current.business_day!==day||current.access_token!==access||Number(current.expires_at)<=Date.now()/1000+90){reset('ログイン状態が更新または失効しました。スタッフ画面でログインし直し、ここで認証を再確認してください。');return}
 try{
  const state=await api('/rest/v1/rpc/staff_prepared_card_status',{p_card_token:card},access);
  if(mine!==epoch)return;
  if(state!=='active'){ $('status').textContent=state==='prepared'?'未登録カードです。登録は通常のスタッフ画面で行ってください。':'有効なカードではありません。';return}
  const r=await api('/rest/v1/rpc/staff_card_details_v3',{p_card_token:card},access);
  if(mine!==epoch)return;
  if(!r||r.status!=='active'||!r.member_id||typeof r.display_name!=='string'||!Number.isFinite(Number(r.balance)))throw Error('会員データを確認できません');
  if(day!==jstDay()){reset('営業日が切り替わりました。');return}
  render(r);$('status').textContent='会員照会が完了しました。ポイント操作はできません。';
 }catch(_){if(mine===epoch)$('status').textContent='会員照会できませんでした。スタッフ認証と接続を確認してください。'}
 finally{if(mine===epoch){busy=false;$('lookup').disabled=!access&&!isolated;$('start').disabled=!access}}
}
$('checkLogin').addEventListener('click',authenticate);
$('lookup').addEventListener('click',()=>lookup($('cardUrl').value));
$('start').addEventListener('click',async()=>{
 if(busy||(!isolated&&(!access||day!==jstDay()))){reset('スタッフ認証を確認してください。');return}
 epoch++;stop();clearMember();const mine=epoch;$('start').disabled=true;$('status').textContent='NFC読み取りを開始しています…';
 try{const instance=BeesNfcReader.start({validate:v=>!!validCard(v),onCard:v=>{if(mine===epoch)lookup(v)},onError:msg=>{if(mine===epoch)$('status').textContent=msg}});
 scanner=instance;$('stop').disabled=false;await instance.ready;if(mine===epoch)$('status').textContent='カードをスマホ背面へかざしてください。';
 }catch(_){if(mine===epoch){stop();$('start').disabled=false;$('status').textContent='NFCを開始できません。Android版Chromeを確認してください。'}}
});
$('stop').addEventListener('click',()=>{epoch++;stop();$('start').disabled=!access&&!isolated;$('status').textContent='読み取りを停止しました。'});
document.addEventListener('visibilitychange',()=>{if(document.hidden){epoch++;stop();clearMember();$('cardUrl').value='';$('start').disabled=!access&&!isolated;$('lookup').disabled=!access&&!isolated}});
authenticate();
})();