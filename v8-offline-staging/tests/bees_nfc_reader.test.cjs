// Run: node --test v8-offline-staging/tests/bees_nfc_reader.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../common/bees_nfc_reader.js'),'utf8');
function setup(){
 let reader;
 class NDEFReader {
  constructor(){reader=this}
  scan({signal}){this.signal=signal;return Promise.resolve()}
 }
 const window={NDEFReader};
 const context={window,NDEFReader,AbortController,TextDecoder};
 vm.runInNewContext(source,context);
 return {api:window.BeesNfcReader,reader:()=>reader};
}
function urlRecord(value){return {recordType:'url',data:new TextEncoder().encode(value)}}
test('valid URL is returned once',async()=>{
 const {api,reader}=setup();const cards=[],errors=[];
 const scanner=api.start({validate:v=>v==='https://example.test/#card=abc',onCard:v=>cards.push(v),onError:v=>errors.push(v)});
 await scanner.ready;
 reader().onreading({message:{records:[urlRecord('https://example.test/#card=abc')]}});
 assert.equal(cards.length,1);assert.equal(errors.length,0);
 scanner.stop();
});
test('stopped scanner ignores late success and failure events',()=>{
 const {api,reader}=setup();const cards=[],errors=[];
 const scanner=api.start({validate:()=>true,onCard:v=>cards.push(v),onError:v=>errors.push(v)});
 scanner.stop();
 reader().onreading({message:{records:[urlRecord('secret')]}});
 reader().onreadingerror();
 assert.equal(cards.length,0);assert.equal(errors.length,0);
});
test('malformed records and validator exceptions do not leak card data',()=>{
 const {api,reader}=setup();const errors=[];
 api.start({validate:()=>{throw Error('secret')},onCard:()=>assert.fail(),onError:v=>errors.push(v)});
 reader().onreading({message:{records:[urlRecord('secret')]}});
 assert.equal(errors.length,1);assert.ok(!errors[0].includes('secret'));
 reader().onreading({message:{records:[{recordType:'text',data:new Uint8Array([1])}]}});
 assert.equal(errors.length,2);
});
test('unsupported browser produces a clear error',()=>{
 const window={};vm.runInNewContext(source,{window,AbortController,TextDecoder});
 assert.throws(()=>window.BeesNfcReader.start({}),/Web NFC/);
});
