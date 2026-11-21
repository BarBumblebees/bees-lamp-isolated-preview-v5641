'use strict';

window.BeesStoreDirectory = (() => {
 function item(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value ?? '';
  return element;
 }
function safeHttps(value){
 try{const u=new URL(String(value||''));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch(_){return null;}
}
function detailLine(parent,label,value){if(!value)return;const d=item('div','store-detail-line');d.append(item('strong','',label+'：'),document.createTextNode(value));parent.append(d)}
function storeLink(parent,label,value){const uri=safeHttps(value);if(!uri)return;const a=item('a','store-link',label+' ↗');a.href=uri;a.target='_blank';a.rel='noopener noreferrer';parent.append(a)}
function storeCard(store, event, linksForStore, eventPosterUrl){
 const details=item('details','store-detail-card'),title=item('summary','store-summary','');
 const heading=item('span','store-heading');
 heading.append(item('span','store-name',store.name));
 const statusRow=item('span','store-status-row');
 const lamp=item('span','store-status-lamp');lamp.setAttribute('aria-hidden','true');
 const statusText=item('span','store-status-text','状態確認中');
 statusRow.append(lamp,statusText);heading.append(statusRow);title.append(heading);
 // Public store directory currently omits store IDs. Use the verified fixed
 // production IDs only as a display fallback; never use them for writes.
 const knownStoreIds=Object.freeze({
  'Bar Bumblebees':'d46049ae-ada5-4990-907c-b9caa07739f1',
  'Bumble Jerk':'018cc53f-fbc8-4c60-a08e-402f53812428',
  'Cafe & Bar JESTERBEES':'10c14642-822b-4e83-97aa-900bdeab346f'
 });
 details.dataset.storeId=store.id||knownStoreIds[store.name]||'';

 const body=item('div','store-detail-body');
 const info=item('section','store-profile');
 const profile=item('div','store-profile-details');
 detailLine(profile,'店舗紹介',store.description);detailLine(profile,'住所',store.address);
 detailLine(profile,'電話番号',store.phone);detailLine(profile,'営業時間',store.business_hours);
 detailLine(profile,'定休日',store.closed_days);
 if(!profile.childNodes.length)profile.append(item('p','store-profile-empty','住所・営業時間などの店舗詳細は準備中です。'));
 info.append(item('h3','store-profile-heading','店舗情報'),profile);
 const links=item('div','store-links');
 for (const link of linksForStore) storeLink(links, link.label, link.url);
 if(store.map_enabled&&store.address){
   const map=new URL('https://www.google.com/maps/dir/');map.searchParams.set('api','1');map.searchParams.set('destination',[store.name,store.address].filter(Boolean).join(' '));
   storeLink(links,'Googleマップで経路を表示',map.toString());
 }
 if(links.childNodes.length)info.append(links);
 body.append(info);
 if(event){
  const notice=item('section','next-event-card');
  notice.append(item('h3','next-event-heading','📍 次回出店のお知らせ'));
  detailLine(notice,'イベント',event.event_name);
  if(event.event_date){
   const day=new Date(event.event_date+'T12:00:00+09:00');
   const dateText=Number.isFinite(day.getTime())?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(day):event.event_date;
   detailLine(notice,'開催日',dateText);
  }
  detailLine(notice,'開催時間',event.event_hours);
  detailLine(notice,'会場',event.venue_name);
  detailLine(notice,'会場住所',event.venue_address);
  // Event poster/details and the venue map are intentionally separate controls.
  const actions=item('div','store-links event-action-links');
  const detailsButton=item('button','store-link event-details-button','イベント詳細・ポスターを見る');
  detailsButton.type='button';detailsButton.setAttribute('aria-expanded','false');
  const eventDetail=item('div','event-expanded-details');eventDetail.hidden=true;
  const posterUrl=eventPosterUrl(event.poster_path);
  if(posterUrl){
    const poster=item('img','event-poster');poster.src=posterUrl;
    poster.alt=(event.event_name||'イベント')+' の告知ポスター';poster.loading='lazy';
    poster.addEventListener('error',()=>{poster.remove();eventDetail.prepend(item('p','hint','ポスター画像を読み込めませんでした。'));});
    eventDetail.append(poster);
  }
  if(event.event_description){
    eventDetail.append(item('h4','event-info-heading','イベント詳細'));
    eventDetail.append(item('p','event-description',event.event_description));
  }else if(!posterUrl){eventDetail.append(item('p','event-description','イベント名・日時・会場の詳細は上記をご確認ください。ポスター画像は準備中です。'));}
  detailsButton.addEventListener('click',()=>{
    const open=eventDetail.hidden;eventDetail.hidden=!open;
    detailsButton.setAttribute('aria-expanded',String(open));
    detailsButton.textContent=open?'イベント詳細を閉じる':'イベント詳細・ポスターを見る';
  });
  actions.append(detailsButton);
  if(event.venue_address){
   const map=new URL('https://www.google.com/maps/dir/');map.searchParams.set('api','1');map.searchParams.set('destination',[event.venue_name,event.venue_address].filter(Boolean).join(' '));
   storeLink(actions,'会場へのアクセス',map.toString());
  }
  notice.append(actions,eventDetail);
  body.append(notice);
 }
 details.append(title,body);return details;
}

 function applyStatuses(root, statuses){
  const byId=new Map((Array.isArray(statuses)?statuses:[]).map(x=>[x.store_id,x.status]));
  root.querySelectorAll('.store-detail-card').forEach(card=>{
   const status=byId.get(card.dataset.storeId);
   const label=status==='OPEN'?'OPEN 営業してるよ':status==='AWAY'?'AWAY 外出中（サボってます）':status==='CLOSE'?'CLOSE 準備中だよ':'状態確認中';
   card.dataset.operatingStatus=['OPEN','AWAY','CLOSE'].includes(status)?status:'UNKNOWN';
   card.querySelector('.store-status-text').textContent=label;
  });
 }
 return { storeCard, applyStatuses };
})();
