/* Shared Web NFC reader for isolated v5.6.41 pages. No network, storage or card-token logging. */
(function(global){'use strict';
function decodeRecord(record){
 if(!record||!['url','absolute-url'].includes(record.recordType))return null;
 try{
  if(record.recordType==='absolute-url'&&typeof record.mediaType==='string'&&record.mediaType)return record.mediaType;
  if(!record.data)return null;
  return new TextDecoder().decode(record.data);
 }catch(_){return null}
}
function start(options){
 if(!('NDEFReader' in global))throw Error('このブラウザはWeb NFCに非対応です。Android版Chromeを使用してください。');
 if(typeof options?.validate!=='function'||typeof options?.onCard!=='function')throw TypeError('NFC読み取りの設定が不正です。');
 const controller=new AbortController(),reader=new NDEFReader();
 const error=message=>{if(!controller.signal.aborted)options.onError?.(message)};
 reader.onreadingerror=()=>error('カードを読み取れませんでした。もう一度かざしてください。');
 reader.onreading=event=>{
  if(controller.signal.aborted)return;
  try{
   for(const record of event.message?.records||[]){
    const value=decodeRecord(record);
    if(value&&options.validate(value)){
     if(!controller.signal.aborted)options.onCard(value);
     return;
    }
   }
   error('BEES POINT NFCのカードURLを確認できません。');
  }catch(_){error('カードの形式を確認できませんでした。もう一度かざしてください。')}
 };
 const ready=reader.scan({signal:controller.signal});
 return {controller,ready,stop:()=>controller.abort()};
}
global.BeesNfcReader=Object.freeze({start,decodeRecord});
})(window);
