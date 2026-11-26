/* R36C2: shared authenticated member panel, new transport deliberately disabled in saved candidate. */
(function(root){'use strict';
function mount({doc,host,binding,getStore,ready=()=>false,visible=()=>false}){
 const $=id=>doc.getElementById('ml40-live-'+id),op=binding.operations;
 let rows=[],opened=false,busy=false,epoch=0,activeSession=null,activeStore=null;
 const key=a=>a?[a.actor_id,a.session_id,a.generation].join(':'):null;
 function usable(){return ready()===true&&visible()===true&&!!binding.session()&&!!getStore();}
 function clear(){epoch++;op.clear();rows=[];opened=false;$('list').hidden=true;$('detail').hidden=true;$('rows').replaceChildren();$('memo').value='';$('summary').textContent='';$('history').replaceChildren();$('search').value='';}
 function sync(){const a=key(binding.session()),store=getStore();if(a!==activeSession||store!==activeStore||!visible()||!usable()){clear();activeSession=a;activeStore=store;}host.hidden=!visible()||!a;$('open').disabled=busy||!usable();$('open').textContent=opened?'メンバー一覧を閉じる':'メンバー一覧';$('search').disabled=busy;for(const button of $('rows').querySelectorAll('button'))button.disabled=busy||!usable();$('status').textContent=!ready()?'新規API未接続・開発候補。既存の会員操作を利用してください。':!getStore()?'操作店舗を選択してください。':$('status').textContent;}
 async function run(fn){if(busy||!usable())return;busy=true;const g=epoch,a=key(binding.session()),store=getStore();const valid=()=>g===epoch&&a===key(binding.session())&&store===getStore()&&usable();sync();try{await fn(valid,store);}catch{clear();$('status').textContent='照会を停止しました。';}finally{busy=false;sync();}}
 function render(){root.BeesMemberListView.render({rows:rows.map(r=>({member_no:r.cardNumber,nickname:r.name,row:r})),query:$('search').value,body:$('rows'),scroll:$('scroll'),status:$('count'),disabled:busy,onSelect:m=>void run(async(valid,store)=>{const d=await op.selectDirectory(m.row,store);if(!valid())return;const s=d.selection;$('list').hidden=true;$('detail').hidden=false;$('summary').textContent='No.'+s.card_number+'　'+s.name+' ／ '+d.snapshot.balance+'pt';$('memo').value=s.memo??'';$('history').replaceChildren();for(const h of d.history){const p=doc.createElement('p');p.textContent=h.kind+' '+h.delta+'pt';$('history').append(p);}$('status').textContent='会員照会完了・新規書込は無効です。';})});}
 $('open').onclick=()=>{if(!usable()||busy)return;if(opened){clear();sync();return;}clear();void run(async(valid)=>{let d=await op.list();while(d.hasMore){if(!valid())return;d=await op.list('',true);}if(!valid())return;rows=d.rows;opened=true;$('list').hidden=false;render();$('status').textContent='メンバーを選択してください。';});};
 $('search').oninput=()=>{if(!busy&&opened&&usable())render();};
 sync();return Object.freeze({clear,sync});
}
root.BeesR36MemberPanel=Object.freeze({mount,writeEnabled:false});})(globalThis);