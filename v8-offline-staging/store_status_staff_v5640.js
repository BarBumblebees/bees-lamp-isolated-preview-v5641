'use strict';
// Production release candidate. Deploy only after explicit approval and guarded SQL installation.
(()=>{
 const panel=document.getElementById('operatingLampStaffPanel');
 const list=document.getElementById('operatingLampStaffList');
 const note=document.getElementById('operatingLampStaffMessage');
 if(!panel||!list||!note)return;
 let lastSession=-1,loading=false;
 const states=[['OPEN','🟢 OPEN 営業してるよ'],['AWAY','🟡 AWAY 外出中（サボってます）'],['CLOSE','🔴 CLOSE 準備中だよ']];
 const setMessage=s=>{note.textContent=s};
 async function load(){
  if(loading||!token||!validBusinessDay()||!encounterStaffProfile)return;
  loading=true;setMessage('営業状態を確認中…');
  try{
   const profile=encounterStaffProfile;
   const stores=(operationStores||[]).filter(s=>profile.role==='super_admin'||s.id===profile.default_store_id);
   list.replaceChildren();
   if(!stores.length){setMessage('操作可能な店舗がありません。');return}
   const statuses=await request('/rest/v1/rpc/public_store_operating_status_v5640',{},null);
   if(!Array.isArray(statuses))throw Error('営業状態を取得できません');
   const map=new Map(statuses.map(x=>[x.store_id,x.status]));
   for(const store of stores){
    const row=document.createElement('div');row.className='operatingLampStaffRow';
    const name=document.createElement('strong');name.textContent=store.name;
    const select=document.createElement('select');select.setAttribute('aria-label',store.name+'の営業状態');
    const current=map.get(store.id);
    select.add(new Option('状態を選択してください',''));
    for(const [value,label] of states)select.add(new Option(label,value));
    select.value=states.some(x=>x[0]===current)?current:'';
    let confirmedStatus=states.some(x=>x[0]===current)?current:'';
    const save=document.createElement('button');save.type='button';save.textContent='状態を更新';save.disabled=!select.value;
    select.addEventListener('change',()=>{save.disabled=!select.value});
    save.addEventListener('click',async()=>{
     if(!select.value||!confirm(store.name+' の営業状態を「'+select.selectedOptions[0].text+'」に変更しますか？'))return;
     save.disabled=true;select.disabled=true;setMessage('更新中…');
     try{
      const requestedStatus=select.value;
      // Fail closed: only the intended production Supabase origin is permitted.
      if(typeof BASE!=='string'||new URL(BASE).origin!=='https://cuoruflxfyubjpboqprb.supabase.co'){
       throw Error('安全のため営業状態の更新を停止しました。管理者へご連絡ください。');
      }
      await request('/rest/v1/rpc/staff_set_store_operating_status_v5640',{p_store_id:store.id,p_status:requestedStatus},token);
      // A successful write is authoritative even if the follow-up read fails.
      confirmedStatus=requestedStatus;
      setMessage(store.name+' の状態を保存しました。表示を再確認中…');
      try{
       const latest=await request('/rest/v1/rpc/public_store_operating_status_v5640',{},null);
       if(!Array.isArray(latest))throw Error('取得結果が不正です');
       const confirmed=latest.find(x=>x.store_id===store.id);
       if(!confirmed||!states.some(x=>x[0]===confirmed.status))throw Error('対象店舗の状態を確認できません');
       select.value=confirmed.status;
       confirmedStatus=confirmed.status;
       setMessage(store.name+' の状態を保存・再確認しました。お客様画面は次回の再取得時に反映されます。');
      }catch(refreshError){
       setMessage('保存は成功しましたが、再取得できませんでした：'+refreshError.message+'。「営業状態を再取得」で確認してください。');
      }
     }catch(e){
      select.value=confirmedStatus;
      setMessage('保存できませんでした。表示を元の状態に戻しました：'+e.message);
     }finally{select.disabled=false;save.disabled=!select.value}
    });
    row.append(name,select,save);list.append(row);
   }
   setMessage('営業状態は翌朝8時に自動的にCLOSEとして表示されます。');
  }catch(e){list.replaceChildren();setMessage('営業状態を取得できません：'+e.message+'。通信状態とログイン権限を確認し、再取得してください。')}
  finally{loading=false}
 }
 const refresh=document.getElementById('operatingLampStaffRefresh');
 refresh?.addEventListener('click',load);
 setInterval(()=>{
  const logged=!!token&&validBusinessDay()&&!!encounterStaffProfile;
  panel.classList.toggle('hidden',!logged);
  if(!logged){lastSession=-1;list.replaceChildren();return}
  if(lastSession!==staffSessionVersion&&operationStores){lastSession=staffSessionVersion;void load()}
 },2500);
})();
