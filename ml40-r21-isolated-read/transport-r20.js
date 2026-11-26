/* Only isolated R18, list-only diagnostic pilot. Password/token stay in memory. No refresh or automatic retries. */
(function(root){'use strict';
const ORIGIN='https://sjwitcwhjtznextxswbm.supabase.co', PREFIX='ml40_r18_';
const READ=new Set(['list_registered_cards_v2']);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
function claims(token,now){if(typeof token!=='string'||token.length>16000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))throw Error('session_invalid');let c;try{c=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0))));}catch{throw Error('session_invalid');}if(c.iss!==ORIGIN+'/auth/v1'||c.role!=='authenticated'||!(c.aud==='authenticated'||Array.isArray(c.aud)&&c.aud.includes('authenticated'))||!uuid(c.sub)||!uuid(c.session_id)||!Number.isSafeInteger(c.exp)||c.exp*1000<=now+10000)throw Error('session_invalid');return c;}
function create({fetcher=root.fetch.bind(root),key=root.BeesTrialPublicConfig?.key,now=()=>Date.now()}={}){
 if(typeof key!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)||typeof fetcher!=='function')throw Error('public_config');
 let session=null,generation=0,signing=false;
 async function send(path,body,token,expected){const url=ORIGIN+path, headers={'apikey':key,'Content-Type':'application/json','Accept':'application/json'};if(token)headers.Authorization='Bearer '+token;let response;try{response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}catch{throw Error('transport_unavailable');}if(expected!==generation)throw Error('stale_session');if(!response.ok)throw Error('http_'+response.status);let data;try{data=await response.json();}catch{throw Error('response_invalid');}if(expected!==generation)throw Error('stale_session');return data;}
 function clear(){generation++;session=null;signing=false;}
 function current(){if(!session)return null;try{const c=claims(session.token,now());return Object.freeze({actor_id:c.sub,expires_at:c.exp*1000,environment:'isolated',generation});}catch{clear();return null;}}
 async function signIn(email,password){if(signing||session)throw Error('session_busy');if(typeof email!=='string'||!email.trim()||email.length>254||typeof password!=='string'||!password||password.length>1024)throw Error('credentials_invalid');const g=++generation;signing=true;try{const d=await send('/auth/v1/token?grant_type=password',{email:email.trim(),password},null,g);const c=claims(d?.access_token,now());if(d?.user?.id!==c.sub)throw Error('session_invalid');session={token:d.access_token};return current();}finally{if(g===generation)signing=false;}}
 async function rpc(d){const req=root.BeesTransportR15.validate(d);if(!READ.has(req.name))throw Error('write_disabled');const c=current();if(!c)throw Error('login_required');const token=session.token;return send('/rest/v1/rpc/'+PREFIX+req.name,req.args,token,generation);}
 async function logout(){const token=session?.token;clear();const g=generation;if(!token)return;try{await send('/auth/v1/logout?scope=local',{},token,g);}catch(e){if(e.message!=='response_invalid')throw e;}}
 return Object.freeze({signIn,current,rpc,logout,clear,writeEnabled:false,origin:ORIGIN});
}
root.BeesTransportR20=Object.freeze({create,origin:ORIGIN,writeEnabled:false});
})(globalThis);
