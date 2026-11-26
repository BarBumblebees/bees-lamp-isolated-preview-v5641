/* R33C offline fixture service. No network, real credentials, or durable storage. */
(function(root){'use strict';
const uid=n=>'18400000-0000-4000-8000-'+String(n).padStart(12,'0'),actor=uid(1),sessionId=uid(2),host='ml40-offline.invalid',stamp='2026-11-26T04:00:00Z';
const stores=Object.freeze([{id:uid(10),name:'試験店舗A',visit:5},{id:uid(11),name:'試験店舗B',visit:7}].map(Object.freeze));
function create({now=()=>Date.now()}={}){
 let gen=1,seq=10000,lose=false,dispatchCount=0;
 const members=Array.from({length:120},(_,i)=>({cardId:uid(100+i),memberId:uid(300+i),number:String(910000+i),name:i===119?'試験会員（長いニックネーム）':'試験会員'+String(i+1).padStart(3,'0'),balance:100+i,revision:0,memo:'',version:0,history:[],visits:new Set(),encounter:false}));
 const confirms=new Map(),receipts=new Map(),map=new Map(),storage={getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
 const auth=()=>({environment:'production',current:true,actor_id:actor,session_id:sessionId,generation:gen,bearer:'offline-fixture-not-a-token',expires_at:now()+600000});
 const fakeToken='R'.repeat(43),fakeUrl='https://'+host+'/#card='+fakeToken;
 function member(p){const m=members.find(x=>x.cardId===p.p_card_id);if(!m||p.p_member_id&&m.memberId!==p.p_member_id)throw Error('fixture_binding');return m;}
 function store(p){const s=stores.find(x=>x.id===p.p_store_id);if(!s)throw Error('fixture_store');return s;}
 function env(m,s){return {environment:'production',actor_id:actor,member_id:m.memberId,card_id:m.cardId,store_id:s.id};}
 function receipt(m,s,p,route,action,result){return {...env(m,s),...(route==='scan'?{route}:{}),status:'confirmed',action,request_id:p.p_request_id,result};}
 function entry(m,s,kind,delta){m.balance+=delta;m.revision++;m.history.unshift({kind,delta,created_at:new Date(now()).toISOString(),store:s.name,encounter_staff_name:kind==='encounter'?'試験スタッフ':null});}
 async function dispatch({name,args:p,bearer}){
  dispatchCount++;if(bearer!=='offline-fixture-not-a-token')throw Error('offline_only');
  if(name==='ml40_api_list_registered_cards_v2'){const q=p.p_query.toLowerCase(),all=members.filter(m=>!q||m.number.includes(q)||m.name.toLowerCase().includes(q)),rows=all.slice(p.p_offset,p.p_offset+30);return {scope_store_name:null,has_more:p.p_offset+rows.length<all.length,capabilities:{detail:true,write:true},cards:rows.map(m=>({id:m.cardId,card_number:m.number,display_name:m.name,balance:m.balance,customer_note:m.memo,issued_at:stamp,store_name:stores[0].name,staff_name:'試験スタッフ',revoked_at:null}))};}
  if(name==='ml40_api_scan_read_v1'){if(p.p_card_token!==fakeToken)return {environment:'production',status:'unknown'};const m=members[0];return {environment:'production',status:'active',route:'scan',actor_id:actor,session_id:sessionId,card_id:m.cardId,member_id:m.memberId,card_number:m.number,display_name:m.name,balance:m.balance,history:m.history.slice(0,20),scan_write_enabled:false};}
  if(name==='ml40_operation_receipt_v1'||name==='ml40_api_scan_receipt_v1'){const r=receipts.get(p.p_request_id);return r||{environment:'production',status:'unknown'};}
  const m=member(p);
  if(name==='ml40_api_registered_card_activity_v2')return {visits:[],encounter_count:null,history:m.history.slice(0,20).map(h=>({...h,store_name:h.store}))};
  const s=store(p),route=name.includes('_scan_')?'scan':'directory';
  if(route==='scan'&&(m!==members[0]||p.p_card_token!==fakeToken))throw Error('fixture_token');
  if(name.endsWith('_memo_read_v1'))return {...env(m,s),memo:m.memo,memo_version:m.version};
  if(name.endsWith('_checkout_snapshot_v1'))return {...env(m,s),...(route==='scan'?{route}:{}),balance:m.balance,revision:String(m.revision)};
  if(name.endsWith('_checkout_confirm_v1')){
   if(p.p_expected_balance!==m.balance||p.p_expected_revision!==String(m.revision))throw Error('stale');
   const id=uid(seq++),d={...env(m,s),...(route==='scan'?{route}:{}),status:'issued',confirmation_id:id,total:p.p_total,redeem:p.p_redeem,balance_before:m.balance,revision_before:String(m.revision),server_now:new Date(now()).toISOString(),expires_at:new Date(now()+120000).toISOString()};confirms.set(id,{...d,route,used:false});return d;
  }
  if(route!=='directory')throw Error('offline_scan_read_only');
  let r;if(receipts.has(p.p_request_id))throw Error('do_not_resend');
  if(name.endsWith('_checkout_once_v1')){
   const d=confirms.get(p.p_confirmation_id);if(!d||d.used||d.route!==route||d.member_id!==m.memberId||d.card_id!==m.cardId||d.store_id!==s.id||d.total!==p.p_total||d.redeem!==p.p_redeem||d.revision_before!==String(m.revision)||Date.parse(d.expires_at)<=now())throw Error('stale_confirmation');
   d.used=true;const paid=d.total-d.redeem,earned=Math.floor(paid/100)*5,before=m.balance;
   if(d.redeem)entry(m,s,'redeem',-d.redeem);if(earned)entry(m,s,'earn',earned);
   r=receipt(m,s,p,route,'checkout',{total:d.total,redeem:d.redeem,paid,earned,balance_before:before,delta:earned-d.redeem,balance_after:m.balance,confirmation_id:p.p_confirmation_id,revision_before:d.revision_before,revision_after:String(m.revision)});
  }else if(name.endsWith('_point_once_v1')){
   const action=p.p_action,delta=action==='visit'?s.visit:1;if(!['visit','encounter'].includes(action)||delta!==p.p_expected_delta||(action==='visit'?m.visits.has(s.id):m.encounter))throw Error('already_awarded_or_invalid');
   if(action==='visit')m.visits.add(s.id);else m.encounter=true;entry(m,s,action,delta);
   r=receipt(m,s,p,route,action,{transaction_id:uid(seq++),balance:m.balance,delta});
  }else throw Error('fixture_rpc_denied');
  receipts.set(p.p_request_id,r);if(lose){lose=false;throw Error('simulated_lost_response');}return r;
 }
 return Object.freeze({auth,dispatch,storage,stores,fakeUrl,cardHost:host,nextId:()=>uid(seq++),loseNext:()=>{lose=true},invalidate:()=>{gen++},get dispatchCount(){return dispatchCount}});
}
root.BeesR33OfflineFixture=Object.freeze({create});})(globalThis);
