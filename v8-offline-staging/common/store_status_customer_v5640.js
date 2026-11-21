'use strict';
window.BeesOperatingStatus = (()=>{
 function create({read,apply,onResult=()=>{},ready=()=>true,timeoutMs=12000,intervalMs=30000,document:doc=document,window:win=window}){
  let sequence=0,interval=null,active=null;
  async function refresh(source='手動'){
   if(!ready())return;
   const seq=++sequence;
   active?.abort();const controller=new AbortController();active=controller;
   let timer;
   try{
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('営業状態の取得がタイムアウトしました'))},timeoutMs)});
    const rows=await Promise.race([read(controller.signal),deadline]);
    if(seq!==sequence)return;
    if(!Array.isArray(rows))throw Error('営業状態の取得結果が不正です');
    apply(rows);onResult({ok:true,source});
   }catch(error){
    if(seq!==sequence)return;
    apply([]);onResult({ok:false,source,error});
   }finally{clearTimeout(timer);if(seq===sequence)active=null}
  }
  const resume=()=>{if(!doc.hidden)void refresh('画面復帰')},online=()=>{void refresh('オンライン復帰')};
  function start(){
   if(interval!==null)return;
   interval=setInterval(()=>{if(!doc.hidden&&!active)void refresh('30秒更新')},intervalMs);
   doc.addEventListener('visibilitychange',resume);win.addEventListener('online',online);
  }
  function stop(){
   if(interval!==null)clearInterval(interval);interval=null;sequence++;active?.abort();active=null;
   doc.removeEventListener('visibilitychange',resume);win.removeEventListener('online',online);
  }
  return {refresh,start,stop};
 }
 return {create};
})();
