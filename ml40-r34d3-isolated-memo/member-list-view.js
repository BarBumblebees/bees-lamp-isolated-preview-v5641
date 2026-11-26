(function(root){'use strict';
function render({rows,query,body,scroll,status,disabled=false,onSelect}){
 const plan=root.BeesMemberList.searchPlan(rows,query),fragment=document.createDocumentFragment();let jump=null;
 for(const [i,m] of plan.rows.entries()){const tr=document.createElement('tr'),no=document.createElement('td'),td=document.createElement('td'),button=document.createElement('button');no.textContent=m.member_no;button.type='button';button.className='member-select';button.textContent=m.nickname;button.title=m.nickname;button.setAttribute('aria-label',m.member_no+' '+m.nickname+'を選択');button.disabled=disabled;button.onclick=()=>onSelect(m);td.append(button);tr.append(no,td);fragment.append(tr);if(i===plan.target){tr.classList.add('member-jump-target');jump=tr;}}
 body.replaceChildren(fragment);scroll.scrollTop=0;
 if(jump){const header=scroll.querySelector('thead').getBoundingClientRect(),v=scroll.getBoundingClientRect(),r=jump.getBoundingClientRect();scroll.scrollTop=Math.max(0,r.top-v.top-scroll.clientTop-header.height);}
 status.textContent=plan.numeric&&plan.target>=0?(plan.exact?'No. ':'該当番号なし：No. ')+plan.rows[plan.target].member_no+' へ移動（全'+plan.rows.length+'件）':plan.rows.length+'件表示';
 return plan;
}
root.BeesMemberListView=Object.freeze({render});})(globalThis);
