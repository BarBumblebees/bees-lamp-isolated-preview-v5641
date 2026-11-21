/* Offline-only entry point. No login, NFC or database calls. */
(()=>{'use strict';
const attach=()=>{
 if(document.getElementById('offlineDemoEntry'))return;
 const heading=[...document.querySelectorAll('h2')].find(x=>x.textContent.includes('スタッフログイン'));
 if(!heading)return;
 const notice=document.createElement('div');notice.id='offlineDemoEntry';
 notice.style.cssText='padding:14px;margin:12px 0;border:2px solid #d5b65c;border-radius:12px;background:#fff7de;color:#41371b;line-height:1.6';
 const title=document.createElement('strong');title.textContent='隔離オフライン版：本物のログインは使えません';
 const desc=document.createElement('p');desc.textContent='架空のカードで「未登録 → 登録 → お客様画面」の操作を試せます。メールアドレスやパスワードは入力しないでください。';
 const link=document.createElement('a');link.href='./nfc-registration-demo.html';link.textContent='▶ 未登録カード登録のデモを開く';link.style.cssText='display:inline-block;padding:12px 16px;background:#174f40;color:white;border-radius:10px;font-weight:bold;text-decoration:none';
 notice.append(title,desc,link);heading.parentNode.insertBefore(notice,heading.nextSibling);
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});else attach();
})();

// Offline preview integration requested; trigger isolated workflow.
