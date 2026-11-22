(()=>{'use strict';
const BASE='https://cuoruflxfyubjpboqprb.supabase.co';
const KEY='sb_publishable_EdoSdDxZAEeXDKzuN9gVDg_ThW89nz8';
const STORAGE='shop-point-nfc.staff-session.v4';
const $=id=>document.getElementById(id);
let access=null,day=null,epoch=0,scanner=null,busy=false,selectedCard=null,pendingReissue=null,actionBusy=false;
const isolated=(()=>{const meta=document.querySelector('meta[http-equiv="Content-Security-Policy"]');return !!meta&&/connect-src\s+'none'/.test(meta.content)})();
// Match staff.html: business day switches at 08:00 JST, not midnight.
const jstDay=()=>new Date(Date.now()+3600000).toISOString().slice(0,10);
function clearMember(){selectedCard=null;pendingReissue=null;if($('reissuePanel'))$('reissuePanel').classList.add('hidden');if($('reissueUrl'))$('reissueUrl').value='';if($('pointStore'))$('pointStore').replaceChildren();const manage=$('inlineManage');if(manage)manage.classList.add('hidden');if($('fullHistory'))$('fullHistory').replaceChildren();if($('manageStatus'))$('manageStatus').textContent=''; $('member').classList.add('hidden');$('name').textContent='';$('balance').textContent='';$('metadata').textContent='';$('history').replaceChildren() }
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
async function resolveDirectoryCard(r,mine){
 const number=String(r.card_number||'').trim();if(!number)return;
 const data=await api('/rest/v1/rpc/list_registered_cards_v2',{p_query:number,p_kind:'',p_status:'active',p_offset:0},access);
 if(mine!==epoch||!Array.isArray(data?.cards))return;
 const matches=data.cards.filter(c=>String(c.card_number||'').trim()===number&&(!r.member_id||String(c.member_id||'')===String(r.member_id)));
 if(matches.length!==1)return;
 selectedCard=matches[0];try{const stores=await manageRequest('/rest/v1/rpc/staff_card_stock_stores',{});if(mine===epoch&&selectedCard===matches[0]){const select=$('pointStore');select.replaceChildren();const rows=Array.isArray(stores)?stores:Array.isArray(stores?.stores)?stores.stores:Array.isArray(stores?.stock_stores)?stores.stock_stores:[];for(const row of rows){const id=row.id||row.store_id,name=row.name||row.store_name;if(id&&name){const option=document.createElement('option');option.value=id;option.textContent=name;select.append(option)}}}}catch(_){}if(mine!==epoch||selectedCard!==matches[0])return;syncCheckout();$('inlineManage').classList.remove('hidden');$('editName').value=selectedCard.display_name||'';$('editNote').value=selectedCard.customer_note||'';
}
async function manageRequest(path,body){
 if(!selectedCard||!access||day!==jstDay())throw Error('カードを再読み取りしてください');
 let current;try{current=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch(_){}
 if(!current||current.business_day!==day||current.access_token!==access||Number(current.expires_at)<=Date.now()/1000+90)throw Error('スタッフ画面で再ログインしてください');
 return api(path,body,access);
}
async function saveCardField(kind){
 const card=selectedCard;if(!card||actionBusy||pendingCheckout()||localStorage.getItem(STAFF_CHECKOUT_PENDING))return;actionBusy=true;const status=$('manageStatus');const input=$(kind==='name'?'editName':'editNote');const value=input.value.trim();
 if(kind==='name'&&(!value||[...value].length>8)){status.textContent='登録名は1〜8文字です。';return}
 if(kind==='note'&&[...value].length>60){status.textContent='メモは60文字以内です。';return}
 const button=$(kind==='name'?'saveName':'saveNote');button.disabled=true;status.textContent='保存中…';
 try{const result=kind==='name'?await manageRequest('/rest/v1/rpc/manage_registered_card_v1',{p_card_id:card.id,p_action:'rename',p_value:value}):await manageRequest('/rest/v1/rpc/save_registered_card_note_v1',{p_card_id:card.id,p_note:value});
 if(card!==selectedCard)return;
 if(kind==='name'){if(result?.status!=='renamed'||typeof result.display_name!=='string')throw Error('保存結果を確認できません');card.display_name=result.display_name;$('name').textContent=result.display_name+' 様';input.value=result.display_name}
 else{if(typeof result!=='string')throw Error('保存結果を確認できません');card.customer_note=result;input.value=result;$('cardMemo').textContent='メモ：'+(result||'登録なし')}
 status.textContent='保存しました。';
 }catch(e){if(card===selectedCard)status.textContent='保存できません。'+e.message}finally{actionBusy=false;button.disabled=false;syncCheckout()}
}
function render(r){
 clearMember();$('name').textContent=r.display_name+' 様';$('balance').textContent='共通残高 '+Number(r.balance).toLocaleString('ja-JP')+'pt';
 $('metadata').textContent='カード No.'+(r.card_number||'未割当')+' ／ 発行店舗 '+(r.issued_store_name||'記録なし');
 const memo=$('cardMemo');if(memo){const note=typeof r.customer_note==='string'?r.customer_note:typeof r.memo==='string'?r.memo:null;memo.textContent=note===null?'メモ：この照会では取得できません':('メモ：'+(note||'登録なし'));}
 const cardNo=String(r.card_number||'').trim();for(const id of ['editLink','historyLink','reissueLink']){const link=$(id);if(link){link.title=cardNo?'カード No.'+cardNo+' を既存のカード一覧で確認':'既存のカード一覧を開く';}}
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
  render(r);$('status').textContent='会員照会が完了しました。';try{await resolveDirectoryCard(r,mine)}catch(_){if(mine===epoch)$('status').textContent='会員照会完了。編集権限を確認できないため照会のみ表示しています。'}
 }catch(_){if(mine===epoch)$('status').textContent='会員照会できませんでした。スタッフ認証と接続を確認してください。'}
 finally{if(mine===epoch){busy=false;$('lookup').disabled=!access&&!isolated;$('start').disabled=!access}}
}
$('saveName')?.addEventListener('click',()=>saveCardField('name'));
$('saveNote')?.addEventListener('click',()=>saveCardField('note'));
$('loadHistory')?.addEventListener('click',async()=>{const card=selectedCard;if(!card)return;const el=$('fullHistory');el.textContent='履歴を取得中…';try{const data=await manageRequest('/rest/v1/rpc/registered_card_activity_v2',{p_card_id:card.id});if(card!==selectedCard)return;el.replaceChildren();for(const item of data.history||[]){const p=document.createElement('p');p.textContent=[item.created_at?new Date(item.created_at).toLocaleString('ja-JP'):'',item.kind||'ポイント操作',item.store_name||'',String(item.delta)+'pt'].filter(Boolean).join(' · ');el.append(p)}if(!el.childNodes.length)el.textContent='履歴はありません。'}catch(e){if(card===selectedCard)el.textContent='履歴を取得できません。'+e.message}});


// Separate storage schema: never overwrite the existing staff page's pending receipt.
const CHECKOUT_PENDING='bees-reader.checkout-pending.v1';
const STAFF_CHECKOUT_PENDING='shop-point-nfc.checkout-pending.v5';
function pendingCheckout(){try{const p=JSON.parse(localStorage.getItem(CHECKOUT_PENDING)||'null');return p&&typeof p.request_id==='string'&&typeof p.card_id==='string'?p:null}catch(_){return null}}
function checkoutNumbers(){
 const read=id=>{const raw=$(id).value.trim();if(!/^(0|[1-9][0-9]*)$/.test(raw))return null;const n=Number(raw);return Number.isSafeInteger(n)&&n<=2147483647?n:null};
 const total=read('checkoutTotal'),redeem=read('checkoutRedeem');
 if(total===null||redeem===null)return {reason:'会計金額と利用ポイントを0以上の整数で入力してください。'};
 if(!total&&!redeem)return {reason:'会計金額または利用ポイントを入力してください。'};
 if(redeem%10)return {reason:'利用ポイントは10pt単位です。'};
 if(redeem>total)return {reason:'利用ポイントが会計金額を超えています。'};
 if(!selectedCard||redeem>Number(selectedCard.balance))return {reason:'残高が不足しています。'};
 const paid=total-redeem,earned=Math.floor(paid/100)*5;
 return {total,redeem,paid,earned};
}
function syncCheckout(){
 const p=pendingCheckout(),v=checkoutNumbers(),store=$('pointStore'),card=selectedCard;
 const otherPending=Boolean(localStorage.getItem(STAFF_CHECKOUT_PENDING));
 const valid=Boolean(card&&!card.revoked_at&&store?.value&&!v.reason&&!actionBusy&&!p&&!otherPending);$('awardVisitInline').disabled=!card||!!card.revoked_at||!store?.value||actionBusy||!!p||otherPending;$('suspendInline').disabled=!card||!!card.revoked_at||actionBusy||!!p||otherPending;
 $('checkoutInline').disabled=!valid;
 $('checkoutRetryInline').classList.toggle('hidden',!p);
 $('checkoutPreview').textContent=(p||otherPending)?'未確認の会計があります。二重処理を防ぐため新しい会計を停止しています。':v.reason||('実際の支払 '+v.paid+'円 ／ 利用 '+v.redeem+'pt ／ 付与 '+v.earned+'pt ／ 予想残高 '+(Number(card.balance)-v.redeem+v.earned)+'pt');
}
$('checkoutTotal')?.addEventListener('input',syncCheckout);
$('checkoutRedeem')?.addEventListener('input',syncCheckout);
$('pointStore')?.addEventListener('change',syncCheckout);
async function executeCheckout(p){
 const card=selectedCard;const status=$('pointStatus');if(!card||actionBusy||p.card_id!==String(card.id)||pendingCheckout()?.request_id!==p.request_id)return;
 actionBusy=true;syncCheckout();status.textContent='会計結果を確認中…';
 try{
  const result=await manageRequest('/rest/v1/rpc/manage_card_directory_points_v1',{p_card_id:p.card_id,p_action:'checkout',p_request_id:p.request_id,p_store_id:p.store_id,p_total_yen:p.total_yen,p_redeem_points:p.redeem_points});
  if(!result||result.balance_after==null||result.earned_points==null||result.redeemed_points==null||!Number.isFinite(Number(result.balance_after))||!Number.isFinite(Number(result.earned_points))||!Number.isFinite(Number(result.redeemed_points)))throw Error('結果を確認できません');
  const saved=pendingCheckout();if(saved?.request_id===p.request_id)localStorage.removeItem(CHECKOUT_PENDING);
  if(card===selectedCard){card.balance=Number(result.balance_after);$('balance').textContent='共通残高 '+card.balance.toLocaleString('ja-JP')+'pt';status.textContent='会計確定：利用 '+result.redeemed_points+'pt ／ 付与 '+result.earned_points+'pt';$('checkoutTotal').value='';$('checkoutRedeem').value='0'}
 }catch(e){if(card===selectedCard)status.textContent='会計結果が未確認です。新しい会計をせず、前回の受付IDで再確認してください。 '+e.message}
 finally{actionBusy=false;syncCheckout()}
}
$('checkoutInline')?.addEventListener('click',async()=>{
 const card=selectedCard,store=$('pointStore'),v=checkoutNumbers();if(!card||card.revoked_at||v.reason||!store.value||actionBusy||pendingCheckout()||localStorage.getItem(STAFF_CHECKOUT_PENDING))return;
 if(!confirm(['会員：'+card.display_name+' 様','店舗：'+store.selectedOptions[0].textContent,'税込会計：'+v.total+'円','利用：'+v.redeem+'pt','実際の支払：'+v.paid+'円','付与：'+v.earned+'pt','この内容で確定しますか？'].join(String.fromCharCode(10))))return;
 const p={request_id:crypto.randomUUID(),card_id:String(card.id),store_id:store.value,total_yen:v.total,redeem_points:v.redeem};
 try{localStorage.setItem(CHECKOUT_PENDING,JSON.stringify(p));if(pendingCheckout()?.request_id!==p.request_id)throw Error('保存確認に失敗')}catch(_){$('pointStatus').textContent='受付IDを保存できないため会計は実行していません。';return}
 await executeCheckout(p);
});
$('checkoutRetryInline')?.addEventListener('click',async()=>{const p=pendingCheckout();if(!p)return;if(!selectedCard||String(selectedCard.id)!==p.card_id){$('pointStatus').textContent='前回の対象カードを読み取ってください。';return}if(!confirm('前回と同じ受付IDで結果を再確認します。'))return;await executeCheckout(p)});

async function cardAction(path,body,statusId,verify){
 const card=selectedCard;if(!card||actionBusy||pendingCheckout())return;actionBusy=true;const status=$(statusId);status.textContent='処理中…';
 try{const result=await manageRequest(path,body);if(card!==selectedCard)return;if(!verify(result))throw Error('結果を確認できません。再操作せず履歴を確認してください。');status.textContent='操作が完了しました。';return result}
 catch(e){if(card===selectedCard)status.textContent='操作結果を確認できません。'+e.message}
 finally{actionBusy=false}
}
$('awardVisitInline')?.addEventListener('click',async()=>{
 const card=selectedCard,store=$('pointStore'),storeId=store?.value;if(!card||card.revoked_at||!storeId||actionBusy||pendingCheckout()||localStorage.getItem(STAFF_CHECKOUT_PENDING)||!Array.from(store.options).some(o=>o.value===storeId))return;
 if(!confirm('カード No.'+card.card_number+' に '+store.selectedOptions[0].textContent+' の来店ポイントを付与しますか？'))return;
 const result=await cardAction('/rest/v1/rpc/manage_card_directory_points_v1',{p_card_id:card.id,p_action:'visit',p_store_id:storeId},'pointStatus',v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v));
 if(result&&card===selectedCard){try{const fresh=await manageRequest('/rest/v1/rpc/manage_card_directory_points_v1',{p_card_id:card.id,p_action:'select'});if(card===selectedCard&&Number.isFinite(Number(fresh.balance))){card.balance=Number(fresh.balance);$('balance').textContent='共通残高 '+card.balance.toLocaleString('ja-JP')+'pt';syncCheckout()}}catch(_){}}
});
$('suspendInline')?.addEventListener('click',async()=>{
 const card=selectedCard;if(!card||actionBusy||pendingCheckout()||localStorage.getItem(STAFF_CHECKOUT_PENDING)||!confirm('カード No.'+card.card_number+' を一時停止しますか？旧カードではポイント操作ができなくなります。'))return;
 const result=await cardAction('/rest/v1/rpc/manage_registered_card_v1',{p_card_id:card.id,p_action:'revoke',p_value:null},'reissueStatus',v=>v?.status==='revoked');
 if(result&&card===selectedCard){card.revoked_at=true;$('suspendInline').disabled=true;$('reissueStatus').textContent='一時停止しました。新カードURLを準備できます。'}
});
$('prepareReissueInline')?.addEventListener('click',()=>{
 const card=selectedCard;if(!card||!card.revoked_at||actionBusy||pendingCheckout()){$('reissueStatus').textContent='再発行の前に旧カードを一時停止してください。';return}
 const bytes=crypto.getRandomValues(new Uint8Array(32));pendingReissue={card,token:btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')};
 $('reissueUrl').value='shop-point-nfc-customer-test-1107.pages.dev/#card='+pendingReissue.token;
 $('reissueWritten').checked=false;$('reissuePanel').classList.remove('hidden');$('reissueStatus').textContent='新品カードにURLを書き込み、確認してから確定してください。';
});
$('copyReissueUrl')?.addEventListener('click',async()=>{if(!pendingReissue)return;try{await navigator.clipboard.writeText($('reissueUrl').value);$('reissueStatus').textContent='URLをコピーしました。'}catch(_){$('reissueStatus').textContent='コピーできません。URLを確認してください。'}});
$('confirmReissueInline')?.addEventListener('click',async()=>{
 const pending=pendingReissue;if(!pending||pending.card!==selectedCard||!$('reissueWritten').checked||actionBusy||pendingCheckout())return;
 if(!confirm('カード No.'+pending.card.card_number+' を再発行しますか？旧URLは無効になります。'))return;
 const result=await cardAction('/rest/v1/rpc/reissue_card_with_qr_v1',{p_card_id:pending.card.id,p_card_token:pending.token},'reissueStatus',v=>v?.status==='reissued');
 if(result&&pending===pendingReissue){clearMember();$('status').textContent='再発行が完了しました。新カードを読み直してください。'}
});

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