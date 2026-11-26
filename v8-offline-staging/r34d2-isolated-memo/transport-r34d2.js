/* R34D2 isolated memo-only transport. Fixed test note, no checkout/point writes, no retries. */
(function(root){'use strict';
const ORIGIN='https://sjwitcwhjtznextxswbm.supabase.co', PREFIX='ml40_r18_';
const LIST='list_registered_cards_v2', EMAIL='ml40-r22-writer@example.invalid';
const STORE='18400000-0000-4000-8000-000000000001', CARD='18400000-0000-4000-8000-000000000021', MEMBER='18400000-0000-4000-8000-000000000011';
const ALLOW=new Set([LIST,'registered_card_activity_v2','ml40_api_directory_memo_read_v1','ml40_api_directory_checkout_snapshot_v1','ml40_operation_receipt_v1','ml40_api_directory_memo_once_v1']);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
function claims(token,now){if(typeof token!=='string'||token.length>16000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))throw Error('session_invalid');let c;try{c=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0))));}catch{throw Error('session_invalid');}if(c.iss!==ORIGIN+'/auth/v1'||c.role!=='authenticated'||!(c.aud==='authenticated'||Array.isArray(c.aud)&&c.aud.includes('authenticated'))||!uuid(c.sub)||!uuid(c.session_id)||!Number.isSafeInteger(c.exp)||c.exp*1000<=now+10000)throw Error('session_invalid');return c;}
function create({fetcher=root.fetch.bind(root),key=root.BeesTrialPublicConfig?.key,now=()=>Date.now()}={}){
 if(typeof key!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)||typeof fetcher!=='function')throw Error('public_config');
 let session=null,generation=0,signing=false,permitted=false; const businessDay=()=>new Date(now()+3600000).toISOString().slice(0,10);
 async function send(path,body,token,expected){const url=ORIGIN+path, headers={'apikey':key,'Content-Type':'application/json','Accept':'application/json'};if(token)headers.Authorization='Bearer '+token;let response;try{response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}catch{throw Error('transport_unavailable');}if(expected!==generation)throw Error('stale_session');if(!response.ok)throw Error('http_'+response.status);let data;try{data=await response.json();}catch{throw Error('response_invalid');}if(expected!==generation)throw Error('stale_session');return data;}
 function clear(){generation++;session=null;signing=false;permitted=false;}
 function current(){if(!session)return null;try{if(session.day!==businessDay())throw Error('business_day');const c=claims(session.token,now());return Object.freeze({actor_id:c.sub,session_id:c.session_id,expires_at:c.exp*1000,environment:'isolated',generation});}catch{clear();return null;}}
 async function signIn(email,password){if(signing||session)throw Error('session_busy');if(email!==EMAIL)throw Error('writer_account_required');if(typeof email!=='string'||!email.trim()||email.length>254||typeof password!=='string'||!password||password.length>1024)throw Error('credentials_invalid');const g=++generation;signing=true;try{const d=await send('/auth/v1/token?grant_type=password',{email:email.trim(),password},null,g);const c=claims(d?.access_token,now());if(d?.user?.id!==c.sub)throw Error('session_invalid');session={token:d.access_token,day:businessDay()};return current();}finally{if(g===generation)signing=false;}}
 async function rpc(d){const req=root.BeesTransportR15.validate(d);if(!ALLOW.has(req.name))throw Error('operation_denied');const c=current();if(!c)throw Error('login_required');const args=req.args,token=session.token,g=generation;
 if(req.name===LIST){permitted=false;if(args.p_query!==''||args.p_kind!=='all'||args.p_offset!==0||args.p_status!=='active')throw Error('fixture_scope');const data=await send('/rest/v1/rpc/'+PREFIX+req.name,args,token,g);const v=root.BeesProductionReadContract.directory(data,'active');if(data.trial_capabilities?.detail!==true||data.trial_capabilities?.write!==true||v.scopeStoreName!=='ML40試験店舗A'||v.hasMore||v.cards.length!==1||v.cards[0].cardId!==CARD||v.cards[0].cardNumber!=='900101'||v.cards[0].store!=='ML40試験店舗A')throw Error('writer_permission_or_fixture');permitted=true;return data;}
 if(!permitted)throw Error('writer_permission_required');
 if(('p_store_id'in args&&args.p_store_id!==STORE)||('p_card_id'in args&&args.p_card_id!==CARD)||('p_member_id'in args&&args.p_member_id!==MEMBER))throw Error('fixture_scope');
 
 if(req.name==='ml40_api_directory_memo_once_v1'&&args.p_note!=='ML40動作確認・R34D')throw Error('trial_memo');
 return send('/rest/v1/rpc/'+PREFIX+req.name,args,token,g);
 }
 async function logout(){const token=session?.token;clear();const g=generation;if(!token)return;try{await send('/auth/v1/logout?scope=local',{},token,g);}catch(e){if(e.message!=='response_invalid')throw e;}}
 return Object.freeze({signIn,current,rpc,logout,clear,get readEnabled(){return permitted&&!!current()},get writeEnabled(){return permitted&&!!current()},origin:ORIGIN});
}
root.BeesTransportR22=Object.freeze({create,origin:ORIGIN,email:EMAIL,store:STORE,card:CARD,member:MEMBER});
})(globalThis);
