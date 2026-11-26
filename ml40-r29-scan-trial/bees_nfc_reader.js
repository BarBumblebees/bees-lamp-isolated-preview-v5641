/* Shared Web NFC reader for isolated v5.6.41 pages. No network, storage or card-token logging. */
(function(global){'use strict';
function decodeRecord(record){if(!record||!['url','absolute-url'].includes(record.recordType))return null;
try{return record.recordType==='absolute-url'&&record.mediaType?record.mediaType:new TextDecoder().decode(record.data)}catch(_){return null}}
function start(options){if(!('NDEFReader' in global))throw Error('このブラウザはWeb NFCに非対応です。Android版Chromeを使用してください。');
const controller=new AbortController(),reader=new NDEFReader();
reader.onreadingerror=()=>options.onError?.('カードを読み取れませんでした。もう一度かざしてください。');
reader.onreading=event=>{for(const record of event.message.records){const value=decodeRecord(record);if(value&&options.validate(value)){options.onCard(value);return}}options.onError?.('BEES POINT NFCのカードURLを確認できません。')};
const ready=reader.scan({signal:controller.signal});return {controller,ready,stop:()=>controller.abort()}}
global.BeesNfcReader=Object.freeze({start,decodeRecord});
})(window);
