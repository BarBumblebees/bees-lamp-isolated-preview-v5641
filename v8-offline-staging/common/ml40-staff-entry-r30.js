/* ML40-R30 isolated staff menu entry. No network, session transfer or card writes. */
(function(root){'use strict';
function decide(s){if(!s||s.authorized!==true||s.home!==true)return 'auth';if(s.busy!==false||s.scanning!==false)return 'busy';if(s.legacyPending!==false)return 'pending';return 'ready';}
function create({state,clearSelection,navigate,onStatus}){let leaving=false;
function sync(){return leaving?'busy':decide(state());}
function open(){const first=sync();if(first!=='ready'){onStatus(first);return false;}leaving=true;try{clearSelection();if(decide(state())!=='ready'){leaving=false;onStatus(decide(state()));return false;}navigate('./staff-operations/index.html');return true;}catch{leaving=false;onStatus('error');return false;}}
return Object.freeze({sync,open});}
root.BeesR30StaffEntry=Object.freeze({decide,create});})(globalThis);