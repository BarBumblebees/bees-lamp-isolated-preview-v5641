'use strict';

function cardQrPng(url){
 const qr=window.qrcode(0,'M');
 qr.addData(url,'Byte');
 qr.make();
 const modules=qr.getModuleCount();
 const quietZone=4;
 const scale=16;
 const canvas=document.createElement('canvas');
 canvas.width=canvas.height=(modules+2*quietZone)*scale;
 const context=canvas.getContext('2d');
 context.fillStyle='#fff';
 context.fillRect(0,0,canvas.width,canvas.height);
 context.fillStyle='#000';
 for(let row=0;row<modules;row++){
  for(let col=0;col<modules;col++){
   if(qr.isDark(row,col))context.fillRect((col+quietZone)*scale,(row+quietZone)*scale,scale,scale);
  }
 }
 return canvas.toDataURL('image/png');
}
