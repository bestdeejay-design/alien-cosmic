// S2 — новые скины сезона 2, отдельные от S1. База: концепт units-showcase.png — Гелиос углы/панели teal+amber, Кхарид шипы/хитин orange+violet.
// Сохраняет совместимость: тот же интерфейс drawUnit(ctx,u,rx,ry), те же u-поля, анимация через performance.now()+id.
import { TILE, LOGIC_DT, MAP_W, MAP_H, COLORS } from './config.js';
function rr(ctx,x,y,w,h,r){ r=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function poly(ctx,p){ ctx.beginPath(); ctx.moveTo(p[0],p[1]); for(let i=2;i<p.length;i+=2) ctx.lineTo(p[i],p[i+1]); ctx.closePath(); }
export function drawUnit(ctx,u,rx,ry){
  const isP=u.side==='player';
  const main=isP?COLORS.player:COLORS.enemy;
  const dark=isP?COLORS.playerDark:COLORS.enemyDark;
  const bright=isP?COLORS.playerBright:COLORS.enemyBright;
  const hull='#0e2028', hull2='#233b44', hullHi='#3ecac0', amber='#f3c579', heat='#ffb36b';
  const flesh='#2a1430', flesh2='#5a2a4a', maw='#140a18', bone='#e8dcc0', outline=isP?'#081418':'#2a1113';
  const bio='#7dff8a', alien=u.faction==='alien';
  ctx.fillStyle='rgba(0,8,13,0.47)'; ctx.beginPath(); ctx.ellipse(rx,ry+6,u.r+3,u.r*0.55,0,0,Math.PI*2); ctx.fill();
  if(u.selected){ ctx.strokeStyle=bright; ctx.lineWidth=1.8; ctx.beginPath(); ctx.ellipse(rx,ry+2,u.r+6,u.r+4,0,0,Math.PI*2); ctx.stroke(); }
  ctx.save(); ctx.translate(rx,ry); ctx.rotate(u.angle);
  const t=performance.now()*0.001+u.id*1.618;
  const pulse=0.5+0.5*Math.sin(t*2.85), flick=0.72+0.28*Math.sin(t*23+u.id), step=u.moving?Math.sin(t*14):0, sway=Math.sin(t*2.1)*0.5;
  const cdMax=u.cfg.cooldown||1, recoil=u.cd>0?Math.min(1,u.cd/cdMax):0, heatGlow=Math.max(pulse*0.35,recoil), eng=u.moving?1:0.45;
  const spec=(x,y,rx,ry,a=0.3)=>{ ctx.fillStyle=`rgba(255,255,255,${a})`; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); };
  if(alien){
    ctx.fillStyle='rgba(20,8,26,0.4)'; ctx.beginPath(); ctx.ellipse(0,4,u.r+1,u.r*0.5,0,0,Math.PI*2); ctx.fill();
    if(u.type==='worker'){
      // S2 собиратель: 3 бронированных сегмента, массивные клешни, спинной кристалл
      ctx.strokeStyle=outline; ctx.lineWidth=2;
      for(let i=0;i<3;i++){ const lx=-6+i*6, sw=(i%2?step:-step)*1.3; ctx.beginPath(); ctx.moveTo(lx,-4); ctx.lineTo(lx+2+sw,-9); ctx.stroke(); ctx.beginPath(); ctx.moveTo(lx,4); ctx.lineTo(lx+2-sw,9); ctx.stroke(); }
      ctx.fillStyle=flesh; ctx.beginPath(); ctx.ellipse(-7,0,5.5,6.8,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=dark; ctx.beginPath(); ctx.ellipse(-1,0,6,7.8,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=main; ctx.beginPath(); ctx.ellipse(5,0,5.2,6.2,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=outline; ctx.lineWidth=1.4; ctx.beginPath(); ctx.ellipse(-1,0,6,7.8,0,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(5,0,5.2,6.2,0,0,Math.PI*2); ctx.stroke();
      // S2: кристаллический нарост на спине
      ctx.fillStyle=bio; ctx.globalAlpha=0.9; poly(ctx,[-3,-7, -1,-12, 2,-7]); ctx.fill(); ctx.globalAlpha=1; ctx.beginPath(); ctx.arc(-1,-12,1.4,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=bright; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(9,-4); ctx.quadraticCurveTo(14,-4,15,-7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(9,4); ctx.quadraticCurveTo(14,4,15,7); ctx.stroke();
      ctx.shadowColor=bio; ctx.shadowBlur=7; ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(7.5,0,2.6+pulse,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; spec(2,-4,1.8,1,0.18);
    } else if(u.type==='marine'){
      ctx.fillStyle=dark; ctx.beginPath(); ctx.ellipse(-1,0,11,7.8,0,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=1.8; ctx.beginPath(); ctx.ellipse(-1,0,11,7.8,0,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=main; ctx.beginPath(); ctx.ellipse(1,0,7.5,5.2,0,0,Math.PI*2); ctx.fill();
      for(let i=0;i<5;i++){ const sx=-7+i*3.4,h=5.5+(i%2)*2.5; ctx.fillStyle=flesh; poly(ctx,[sx-1.6,-4.5,sx,-4.5-h,sx+1.6,-4.5]); ctx.fill(); ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(sx,-4.5-h,1.3,0,Math.PI*2); ctx.fill(); }
      ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(3,-5.4,1.6,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(3,5.4,1.6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=maw; ctx.beginPath(); ctx.arc(8.8,0,3.8,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=bright; poly(ctx,[10.8,-2.8,13.4,-1.5,10.8,-0.4]); ctx.fill(); poly(ctx,[10.8,2.8,13.4,1.5,10.8,0.4]); ctx.fill();
      ctx.shadowColor=bright; ctx.shadowBlur=8; ctx.fillStyle=bright; ctx.beginPath(); ctx.arc(8.8,0,1.8+pulse*0.8,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
    } else if(u.type==='buggy'){
      ctx.strokeStyle=dark; ctx.lineWidth=2.6; const f=step*3; ctx.beginPath(); ctx.moveTo(5,-4); ctx.lineTo(12,-10-f); ctx.stroke(); ctx.beginPath(); ctx.moveTo(5,4); ctx.lineTo(12,10+f); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-6,-4); ctx.lineTo(-13,-9+f); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-6,4); ctx.lineTo(-13,9-f); ctx.stroke();
      ctx.fillStyle=dark; ctx.beginPath(); ctx.ellipse(-1,0,10.5,6.2,0,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=1.6; ctx.beginPath(); ctx.ellipse(-1,0,10.5,6.2,0,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=main; ctx.beginPath(); ctx.ellipse(-2,0,7.2,4.2,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle=flesh; poly(ctx,[-5,-4,-2,-11,1,-4]); ctx.fill(); ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(-2,-11,1.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=dark; ctx.beginPath(); ctx.arc(8,0,4.8,0,Math.PI*2); ctx.fill(); ctx.fillStyle=bright; poly(ctx,[11.5,-2.7,14.2,-1.6,11.5,-0.6]); ctx.fill(); poly(ctx,[11.5,2.7,14.2,1.6,11.5,0.6]); ctx.fill();
      ctx.shadowColor=bio; ctx.shadowBlur=6; ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(9.5,-2.7,1.5,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(11,0,1.6,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(9.5,2.7,1.5,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
    } else if(u.type==='tank'){
      ctx.fillStyle=flesh; ctx.fillRect(-12,-14,6,4); ctx.fillRect(-12,10,6,4); ctx.fillRect(4,-13.5,6,4); ctx.fillRect(4,9.5,6,4);
      ctx.fillStyle=dark; ctx.beginPath(); ctx.ellipse(0,0,15.5,12,0,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(0,0,15.5,12,0,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=main; ctx.beginPath(); ctx.ellipse(3,0,11.5,8.2,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=flesh; ctx.beginPath(); ctx.ellipse(-4,-9.5,6,4.2,-0.3,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-4,9.5,6,4.2,0.3,0,Math.PI*2); ctx.fill(); ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(-4,-9.5,1.6,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(-4,9.5,1.6,0,Math.PI*2); ctx.fill();
      for(const s of [-1,1]){ ctx.fillStyle=bone; ctx.beginPath(); ctx.moveTo(0,8*s); ctx.quadraticCurveTo(6,13*s,12,19*s); ctx.quadraticCurveTo(13.5,16.5*s,13,15*s); ctx.quadraticCurveTo(8,11*s,4,7*s); ctx.closePath(); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=1.2; ctx.stroke(); ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(2,7.5*s,1.6,0,Math.PI*2); ctx.fill(); }
      ctx.fillStyle=maw; ctx.beginPath(); ctx.ellipse(13,0,2.8,4.5,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle=bone; for(let i=-1;i<=1;i++) poly(ctx,[12,i*2.4-0.8,14.8,i*2.4,12,i*2.4+0.8]); ctx.fill();
      ctx.shadowColor=bright; ctx.shadowBlur=9; ctx.fillStyle=bright; ctx.beginPath(); ctx.arc(8,0,3.4+pulse,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; ctx.fillStyle=maw; ctx.beginPath(); ctx.arc(8,0,1.4,0,Math.PI*2); ctx.fill();
    } else if(u.type==='medic'){
      const pr=8.8+pulse; ctx.fillStyle='rgba(90,42,74,0.9)'; ctx.beginPath(); ctx.ellipse(0,0,pr,pr*0.7,0,0,Math.PI*2); ctx.fill();
      for(let i=0;i<6;i++){ const a=(i*Math.PI*2)/6+t*0.6; ctx.fillStyle=flesh2; ctx.beginPath(); ctx.ellipse(Math.cos(a)*7,Math.sin(a)*4.8,3.2,1.8,a,0,Math.PI*2); ctx.fill(); }
      ctx.fillStyle=main; ctx.beginPath(); ctx.arc(0,0,4.2,0,Math.PI*2); ctx.fill(); ctx.shadowColor=bio; ctx.shadowBlur=6; ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(0,0,2.2+pulse*0.6,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
    } else if(u.type==='flamer'){
      ctx.fillStyle=flesh; ctx.beginPath(); ctx.ellipse(0,0,12,8,0,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=1.8; ctx.stroke();
      ctx.fillStyle=main; ctx.beginPath(); ctx.ellipse(0,0,8,5,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle=maw; ctx.beginPath(); ctx.arc(9,0,5,0,Math.PI*2); ctx.fill();
      ctx.shadowColor=bio; ctx.shadowBlur=8; ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(9,0,2+pulse,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
      for(let i=0;i<3;i++){ const a=t*1.2+i*2; ctx.fillStyle=bone; ctx.beginPath(); ctx.arc(Math.cos(a)*4, Math.sin(a)*3,1.2,0,Math.PI*2); ctx.fill(); }
    } else if(u.type==='scout'){
      ctx.fillStyle=dark; ctx.beginPath(); ctx.ellipse(0,0,9,6,0,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=1.6; ctx.stroke();
      ctx.fillStyle=main; ctx.beginPath(); ctx.ellipse(0,0,5.5,3.5,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=hull2; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(-5,-3); ctx.lineTo(-8,-8); ctx.stroke(); ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(-8,-8,1.6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=maw; ctx.beginPath(); ctx.arc(7,0,4,0,Math.PI*2); ctx.fill(); ctx.shadowColor=bio; ctx.shadowBlur=6; ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(7,0,1.6+pulse*0.7,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
      ctx.fillStyle=bone; poly(ctx,[7,-2,10,-1,7,0]); ctx.fill(); poly(ctx,[7,2,10,1,7,0]); ctx.fill();
    } else {
      ctx.fillStyle=flesh; ctx.beginPath(); ctx.ellipse(0,0,13,10,0,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=1.8; ctx.stroke();
      ctx.fillStyle=main; ctx.beginPath(); ctx.ellipse(2,0,8,5.5,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=maw; ctx.beginPath(); ctx.arc(10,0,4,0,Math.PI*2); ctx.fill(); ctx.shadowColor=bio; ctx.shadowBlur=7; ctx.fillStyle=bio; ctx.beginPath(); ctx.arc(10,0,2+pulse,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
      for(let i=0;i<4;i++){ const a=t*0.8+i*1.5; ctx.fillStyle=bone; ctx.beginPath(); ctx.arc(Math.cos(a)*6, Math.sin(a)*5,1,0,Math.PI*2); ctx.fill(); }
    }
  } else {
    // S2 Гелиос — более острые панели, контрастные фаски, яркий hullHi кант
    ctx.fillStyle=main; ctx.globalAlpha=0.12+0.09*eng*flick; ctx.beginPath(); ctx.ellipse(0,4,u.r+3,u.r*0.62,0,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
    if(u.type==='worker'){
      ctx.fillStyle=hull; ctx.fillRect(-9,-11,6,3.4); ctx.fillRect(-9,7.6,6,3.4); ctx.fillRect(3,-11,6,3.4); ctx.fillRect(3,7.6,6,3.4);
      ctx.fillStyle=main; ctx.globalAlpha=0.6+0.4*flick*eng; ctx.fillRect(-8,-10.6,4,2.4); ctx.fillRect(-8,8.2,4,2.4); ctx.fillRect(4,-10.6,4,2.4); ctx.fillRect(4,8.2,4,2.4); ctx.globalAlpha=1;
      ctx.strokeStyle=hull2; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(6,-5); ctx.lineTo(12,-7+step); ctx.stroke(); ctx.beginPath(); ctx.moveTo(6,5); ctx.lineTo(12,7-step); ctx.stroke();
      ctx.strokeStyle=amber; ctx.lineWidth=1.8; ctx.beginPath(); ctx.moveTo(12,-7+step); ctx.lineTo(14.5,-8+step); ctx.stroke(); ctx.beginPath(); ctx.moveTo(12,7-step); ctx.lineTo(14.5,8-step); ctx.stroke();
      ctx.fillStyle=hull; poly(ctx,[11,0,5,-9,-6,-9,-11,0,-6,9,5,9]); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.2; ctx.stroke();
      ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke(); ctx.fillStyle=hull2; poly(ctx,[7,0,3,-5,-4,-5,-7,0,-4,5,3,5]); ctx.fill();
      ctx.strokeStyle=hullHi; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(-4,-5); ctx.lineTo(3,-5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-4,5); ctx.lineTo(3,5); ctx.stroke();
      ctx.strokeStyle=hull2; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-6,-8); ctx.lineTo(-6,-12); ctx.stroke(); ctx.fillStyle=amber; ctx.globalAlpha=0.4+0.6*(0.5+0.5*Math.sin(t*6)); ctx.beginPath(); ctx.arc(-6,-13,2.2,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
      ctx.shadowColor=bright; ctx.shadowBlur=7; ctx.fillStyle=bright; ctx.beginPath(); ctx.arc(2,0,2.8+pulse,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; spec(2,-4,2,1,0.2);
    } else if(u.type==='marine'){
      ctx.fillStyle=main; ctx.globalAlpha=0.5+0.5*flick*eng; ctx.fillRect(-5,-10.6,5,2.4); ctx.fillRect(-5,8.2,5,2.4); ctx.globalAlpha=1;
      ctx.fillStyle=hull2; ctx.fillRect(-13.5,-4,3,8); ctx.fillStyle=main; ctx.globalAlpha=0.4+0.6*eng*flick; ctx.fillRect(-14.5,-3,1.8,6); ctx.globalAlpha=1;
      const bl=13-recoil*3.5; ctx.fillStyle='#0a1418'; ctx.fillRect(6,-1.9,bl,3.8); ctx.fillStyle=hull2; ctx.fillRect(6+bl-2.5,-2.8,2.5,5.6); if(recoil>0.55){ ctx.fillStyle=heat; ctx.beginPath(); ctx.arc(6+bl+1.5,0,2.6,0,Math.PI*2); ctx.fill(); }
      ctx.fillStyle=hull; poly(ctx,[8,0,3,-9,-8,-9,-11,0,-8,9,3,9]); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.2; ctx.stroke(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle=hull2; poly(ctx,[4,0,0,-6,-6,-6,-8,0,-6,6,0,6]); ctx.fill();
      ctx.fillStyle=amber; ctx.fillRect(-10,-11.5,6,3.6); ctx.fillRect(-10,7.9,6,3.6); ctx.strokeStyle=outline; ctx.lineWidth=1; ctx.strokeRect(-10,-11.5,6,3.6); ctx.strokeRect(-10,7.9,6,3.6);
      ctx.shadowColor=bright; ctx.shadowBlur=7; ctx.fillStyle=bright; ctx.fillRect(-1,-1.4+sway*0.4,6.5,2.8); ctx.shadowBlur=0; spec(-5,-3,2,1,0.22);
    } else if(u.type==='buggy'){
      const fl=(5+9*flick)*eng; ctx.fillStyle=heat; ctx.globalAlpha=0.85; poly(ctx,[-12,-7.5,-12-fl,-5.5,-12,-3.5]); ctx.fill(); poly(ctx,[-12,7.5,-12-fl,5.5,-12,3.5]); ctx.fill(); ctx.globalAlpha=1;
      ctx.fillStyle=hull; ctx.fillRect(-13,-8.5,4,5); ctx.fillRect(-13,3.5,4,5);
      ctx.fillStyle=hull; poly(ctx,[15,0,-6,-11,-11,-11,-3,0,-11,11,-6,11]); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.4; ctx.stroke(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke();
      ctx.strokeStyle=main; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(11,-1.5); ctx.lineTo(-5,-9); ctx.stroke(); ctx.beginPath(); ctx.moveTo(11,1.5); ctx.lineTo(-5,9); ctx.stroke();
      ctx.fillStyle=main; ctx.fillRect(-9,-1.4,14,2.8); ctx.fillStyle=hull2; ctx.beginPath(); ctx.ellipse(4,0,5,3.4,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle=bright; ctx.globalAlpha=0.9; ctx.beginPath(); ctx.ellipse(5,-0.6,2.6,1.4,-0.2,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
      ctx.fillStyle='#0a1418'; ctx.fillRect(11,-3.6,6.5-recoil*2,1.7); ctx.fillRect(11,1.9,6.5-recoil*2,1.7);
      ctx.shadowColor=bright; ctx.shadowBlur=7; ctx.fillStyle=bright; ctx.beginPath(); ctx.arc(-4,0,2.2+pulse*0.7,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
    } else if(u.type==='tank'){
      ctx.fillStyle=hull; ctx.fillRect(-15,-15,24,5); ctx.fillRect(-15,10,24,5); ctx.fillStyle=main; ctx.globalAlpha=0.5+0.5*flick*eng; ctx.fillRect(-13,-14.2,20,3.2); ctx.fillRect(-13,11,20,3.2); ctx.globalAlpha=1;
      ctx.fillStyle=hull; rr(ctx,-14,-11,28,22,6); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.4; ctx.stroke(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle=hull2; poly(ctx,[14,-8,19.5,0,14,8]); ctx.fill(); ctx.strokeStyle=amber; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(15,-5); ctx.lineTo(18,0); ctx.lineTo(15,5); ctx.stroke();
      ctx.fillStyle=hull2; rr(ctx,-9,-7,18,14,5); ctx.fill(); ctx.strokeStyle=outline; ctx.lineWidth=1.6; ctx.stroke(); ctx.fillStyle=main; ctx.beginPath(); ctx.arc(-6,-4.5,1.4,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(-6,4.5,1.4,0,Math.PI*2); ctx.fill();
      const bl2=15-recoil*4; ctx.fillStyle='#0a1418'; ctx.fillRect(7,-5.6,bl2,3.4); ctx.fillRect(7,2.2,bl2,3.4); ctx.fillStyle=main; ctx.fillRect(7+bl2-2.5,-6.4,2.5,5); ctx.fillRect(7+bl2-2.5,1.4,2.5,5); if(recoil>0.5){ ctx.fillStyle=heat; ctx.beginPath(); ctx.arc(7+bl2+1.5,-3.9,2.4,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(7+bl2+1.5,3.9,2.4,0,Math.PI*2); ctx.fill(); }
      ctx.shadowColor=bright; ctx.shadowBlur=7; ctx.fillStyle=bright; ctx.beginPath(); ctx.arc(-3,0,2.8+pulse*0.8,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; ctx.fillStyle=amber; ctx.fillRect(-15.5,-4,2.2,3); ctx.fillRect(-15.5,1,2.2,3); spec(-6,-5,2,1,0.18);
    } else if(u.type==='medic'){
      ctx.fillStyle=main; ctx.globalAlpha=0.55+0.45*flick; ctx.fillRect(-13.5,-2.6,3.4,5.2); ctx.fillRect(10.1,-2.6,3.4,5.2); ctx.fillRect(-2.6,-13.5,5.2,3.4); ctx.fillRect(-2.6,10.1,5.2,3.4); ctx.globalAlpha=1;
      ctx.fillStyle=hull; ctx.beginPath(); ctx.arc(0,0,10.4,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.4; ctx.stroke(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke();
      ctx.strokeStyle=main; ctx.lineWidth=2.4; ctx.beginPath(); ctx.arc(0,0,7.6,t*0.8,t*0.8+Math.PI*1.5); ctx.stroke();
      ctx.fillStyle=hull2; ctx.beginPath(); ctx.arc(0,0,4.8,0,Math.PI*2); ctx.fill(); const cw2=1.8+pulse*0.5; ctx.shadowColor=bright; ctx.shadowBlur=7; ctx.fillStyle=bright; ctx.fillRect(-cw2/2,-6.4,cw2,12.8); ctx.fillRect(-6.4,-cw2/2,12.8,cw2); ctx.shadowBlur=0;
      ctx.strokeStyle=hull2; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(-7,-7); ctx.lineTo(-10,-10); ctx.stroke(); ctx.fillStyle=amber; ctx.beginPath(); ctx.arc(-10.5,-10.5,1.6,0,Math.PI*2); ctx.fill();
    } else if(u.type==='flamer'){
      ctx.fillStyle='#4a2c22'; rr(ctx,-12,-11,11,4,2); ctx.fill(); rr(ctx,-12,7,11,4,2); ctx.fill(); ctx.fillStyle=amber; ctx.fillRect(-12.5,-10.4,2.4,2.8); ctx.fillRect(-12.5,7.6,2.4,2.8); ctx.fillRect(-3.5,-10.4,2.4,2.8); ctx.fillRect(-3.5,7.6,2.4,2.8);
      ctx.fillStyle=hull; rr(ctx,-11,-8,19,16,5); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.2; ctx.stroke(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke(); ctx.fillStyle=hull2; poly(ctx,[8,-8,13.5,-5,13.5,5,8,8]); ctx.fill();
      ctx.fillStyle=bright; ctx.fillRect(-3,-5.5,7,2); ctx.fillRect(-3,3.5,7,2); ctx.strokeStyle=main; ctx.lineWidth=1.2; for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(-9+i*3,-7); ctx.lineTo(-9+i*3,-4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-9+i*3,4); ctx.lineTo(-9+i*3,7); ctx.stroke(); }
      ctx.fillStyle='#0a1418'; poly(ctx,[13,-4.6,18.5,-2.8,18.5,2.8,13,4.6]); ctx.fill(); ctx.shadowColor=heat; ctx.shadowBlur=9; ctx.fillStyle=heat; ctx.beginPath(); ctx.arc(18.5,0,1.8+heatGlow*2.6,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; spec(-4,-4,2,1,0.16);
    } else if(u.type==='scout'){
      ctx.fillStyle=hull; poly(ctx,[12,0,-8,-8,-4,0,-8,8]); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.2; ctx.stroke(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke();
      ctx.strokeStyle=main; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(-6,-6); ctx.moveTo(9,0); ctx.lineTo(-6,6); ctx.stroke(); ctx.fillStyle=bright; ctx.beginPath(); ctx.arc(2,0,2.6,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=hull2; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(-6,-10); ctx.stroke(); ctx.fillStyle=amber; ctx.beginPath(); ctx.arc(-6,-11,1.7+pulse*0.7,0,Math.PI*2); ctx.fill();
      const dx2=10+Math.sin(t*2.2)*2, dy2=-8+Math.cos(t*3.1)*1.6; ctx.strokeStyle=bright; ctx.lineWidth=1; ctx.globalAlpha=0.55; ctx.beginPath(); ctx.moveTo(2,0); ctx.lineTo(dx2,dy2); ctx.stroke(); ctx.globalAlpha=1; ctx.shadowColor=bright; ctx.shadowBlur=6; ctx.fillStyle=bright; ctx.beginPath(); ctx.arc(dx2,dy2,1.9,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
      ctx.fillStyle=heat; ctx.globalAlpha=0.7; poly(ctx,[-8,-3,-8-4*eng,0,-8,3]); ctx.fill(); ctx.globalAlpha=1;
    } else {
      ctx.fillStyle=hull; ctx.fillRect(-16,-13,28,4.6); ctx.fillRect(-16,8.4,28,4.6); ctx.fillStyle=main; ctx.globalAlpha=0.5+0.5*flick*eng; for(let i=0;i<3;i++){ ctx.fillRect(-14+i*8,-12.4,5,3.2); ctx.fillRect(-14+i*8,9.2,5,3.2); } ctx.globalAlpha=1;
      ctx.strokeStyle=hull2; ctx.lineWidth=2.6; ctx.beginPath(); ctx.moveTo(-14,-7); ctx.lineTo(-19,-11); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-14,7); ctx.lineTo(-19,11); ctx.stroke();
      ctx.fillStyle=hull; rr(ctx,-14,-7.5,26,15,4); ctx.fill(); ctx.strokeStyle=hullHi; ctx.lineWidth=1.2; ctx.stroke(); ctx.strokeStyle=outline; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle=hull2; ctx.beginPath(); ctx.arc(-9,0,5,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle=amber; for(let i=0;i<3;i++){ const a=t*0.7+(i*Math.PI*2)/3; ctx.beginPath(); ctx.arc(-9+Math.cos(a)*2.8, Math.sin(a)*2.8,1.3,0,Math.PI*2); ctx.fill(); }
      ctx.fillStyle=hull2; ctx.beginPath(); ctx.arc(2,0,6.6,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=main; ctx.lineWidth=1.6; ctx.beginPath(); ctx.arc(2,0,6.6,0,Math.PI*2); ctx.stroke();
      const bl3=23-recoil*5; ctx.fillStyle='#0a1418'; ctx.fillRect(4,-2.1,bl3,4.2); ctx.fillStyle=main; ctx.fillRect(4+bl3-3,-3.1,3,6.2); if(recoil>0.5){ ctx.fillStyle=heat; ctx.beginPath(); ctx.arc(4+bl3+1.5,0,2.8,0,Math.PI*2); ctx.fill(); }
      ctx.shadowColor=amber; ctx.shadowBlur=7; ctx.fillStyle=amber; ctx.beginPath(); ctx.arc(2,0,2+pulse*0.7,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
    }
  }
  if(u.carrying>0){ ctx.shadowColor=COLORS.mineral; ctx.shadowBlur=8; ctx.fillStyle=COLORS.mineral; poly(ctx,[-10,-3,-6,-8.5,-2,-3,-6,2.5]); ctx.fill(); ctx.shadowBlur=0; ctx.fillStyle='rgba(255,255,255,0.75)'; poly(ctx,[-6,-8.5,-4.4,-3.4,-6,-1]); ctx.fill(); }
  ctx.fillStyle=bright; ctx.globalAlpha=0.95; ctx.fillRect(u.r*0.45,-1.2,3.5,2.4); ctx.globalAlpha=1;
  if(u.flashT>0){ ctx.fillStyle=`rgba(255,255,255,${u.flashT*2.8})`; ctx.beginPath(); ctx.arc(0,0,u.r+2,0,Math.PI*2); ctx.fill(); }
  ctx.restore();
  if(u.selected && u.idleReason==='unreachable'){ ctx.font='bold 13px system-ui, sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#ff6a5e'; ctx.fillText('!',rx+u.r+6,ry-u.r-2); ctx.textAlign='left'; }
  if(u.selected || u.hp<u.maxHp){ const w=u.cfg.vehicle?34:25, x0=rx-w/2, y0=ry-u.r-12, frac=Math.max(0,u.hp/u.maxHp); ctx.fillStyle='rgba(4,15,19,0.88)'; ctx.fillRect(x0-1,y0-1,w+2,6); ctx.fillStyle=frac<0.33?'#ff806e':isP?'#8cedcc':'#ffb078'; ctx.fillRect(x0,y0,w*frac,4); }
}
