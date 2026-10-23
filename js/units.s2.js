// S2 — отдельные высококачественные скины сезона 2, близкие к концепту design/concepts/units-showcase.png
// Интерфейс как в S1: drawUnit(ctx,u,rx,ry), анимация t=performance.now*0.001+id*1.618, shadowBlur≤9
import { TILE, COLORS } from './config.js';
function rr(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function poly(c,p){c.beginPath();c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);c.closePath();}
export function drawUnit(ctx,u,rx,ry){
  const isP=u.side==='player', main=isP?COLORS.player:COLORS.enemy, dark=isP?COLORS.playerDark:COLORS.enemyDark, bright=isP?COLORS.playerBright:COLORS.enemyBright;
  const hull='#0e2230', hull2='#2a4350', hullHi='#7df3e2', amber='#f3c579', heat='#ffb86b', bio='#8aff9e', flesh='#3a1830', maw='#120a14', bone='#e9dcc0', outline=isP?'#081418':'#2a1113', alien=u.faction==='alien';
  ctx.fillStyle='rgba(0,8,13,0.48)';ctx.beginPath();ctx.ellipse(rx,ry+6,u.r+3,u.r*0.55,0,0,Math.PI*2);ctx.fill();
  if(u.selected){ctx.strokeStyle=bright;ctx.lineWidth=1.8;ctx.beginPath();ctx.ellipse(rx,ry+2,u.r+6,u.r+4,0,0,Math.PI*2);ctx.stroke();}
  ctx.save();ctx.translate(rx,ry);ctx.rotate(u.angle);
  const t=performance.now()*0.001+u.id*1.618, pulse=0.5+0.5*Math.sin(t*2.85), flick=0.72+0.28*Math.sin(t*23+u.id), step=u.moving?Math.sin(t*14):0, sway=Math.sin(t*2.1)*0.5, cdMax=u.cfg.cooldown||1, recoil=u.cd>0?Math.min(1,u.cd/cdMax):0, eng=u.moving?1:0.45, heatGlow=Math.max(pulse*0.35,recoil);
  const spec=(x,y,rx,ry,a=0.28)=>{ctx.fillStyle=`rgba(255,255,255,${a})`;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();};
  if(alien){
    ctx.fillStyle='rgba(18,8,24,0.42)';ctx.beginPath();ctx.ellipse(0,4,u.r+1,u.r*0.5,0,0,Math.PI*2);ctx.fill();
    if(u.type==='worker'){
      // S2: трёхсегментный краб, бронированные пластины, кристалл на спине, массивные клешни
      ctx.strokeStyle=outline;ctx.lineWidth=2.2;for(let i=0;i<3;i++){const lx=-6+i*6,sw=(i%2?step:-step)*1.4;ctx.beginPath();ctx.moveTo(lx,-4);ctx.lineTo(lx+2+sw,-10);ctx.stroke();ctx.beginPath();ctx.moveTo(lx,4);ctx.lineTo(lx+2-sw,10);ctx.stroke();}
      ctx.fillStyle='#2e1430';ctx.beginPath();ctx.ellipse(-7,0,5.8,7,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#4a2040';ctx.beginPath();ctx.ellipse(-1,0,6.2,8,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#7a2e52';ctx.beginPath();ctx.ellipse(5,0,5.4,6.4,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=outline;ctx.lineWidth=1.4;ctx.beginPath();ctx.ellipse(-1,0,6.2,8,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(5,0,5.4,6.4,0,0,Math.PI*2);ctx.stroke();
      // спинной кристалл S2
      ctx.fillStyle=bio;poly(ctx,[-4,-7.5,-1.5,-13,1.5,-7.5]);ctx.fill();ctx.shadowColor=bio;ctx.shadowBlur=7;ctx.beginPath();ctx.arc(-1.5,-13,1.6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle=bright;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(9,-3.5);ctx.quadraticCurveTo(14,-3.5,15.5,-7);ctx.stroke();ctx.beginPath();ctx.moveTo(9,3.5);ctx.quadraticCurveTo(14,3.5,15.5,7);ctx.stroke();
      ctx.shadowColor=bio;ctx.shadowBlur=7;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(7.8,0,2.8+pulse,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='marine'){
      ctx.fillStyle='#2a1430';ctx.beginPath();ctx.ellipse(-0.5,0,11.5,8.2,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=1.8;ctx.stroke();
      ctx.fillStyle='#ff7a45';ctx.beginPath();ctx.ellipse(1,0,7.8,5.4,0,0,Math.PI*2);ctx.fill();
      for(let i=0;i<5;i++){const sx=-7+i*3.4,h=6+(i%2)*2.8;ctx.fillStyle='#3a1830';poly(ctx,[sx-1.7,-4.6,sx,-4.6-h,sx+1.7,-4.6]);ctx.fill();ctx.fillStyle=bio;ctx.beginPath();ctx.arc(sx,-4.6-h,1.3,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle=maw;ctx.beginPath();ctx.arc(9,0,4,0,Math.PI*2);ctx.fill();ctx.shadowColor=bio;ctx.shadowBlur=7;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(9,0,1.9+pulse*0.8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;spec(-2,-4,2,1,0.2);
    } else if(u.type==='buggy'){
      ctx.strokeStyle='#2a1430';ctx.lineWidth=2.8;const f=step*3;ctx.beginPath();ctx.moveTo(5,-4);ctx.lineTo(12,-10-f);ctx.stroke();ctx.beginPath();ctx.moveTo(5,4);ctx.lineTo(12,10+f);ctx.stroke();ctx.beginPath();ctx.moveTo(-6,-4);ctx.lineTo(-13,-9+f);ctx.stroke();ctx.beginPath();ctx.moveTo(-6,4);ctx.lineTo(-13,9-f);ctx.stroke();
      ctx.fillStyle='#2a1430';ctx.beginPath();ctx.ellipse(-1,0,11,6.6,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=1.6;ctx.stroke();
      ctx.fillStyle='#ff7a45';ctx.beginPath();ctx.ellipse(-2,0,7.4,4.4,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#5a1030';poly(ctx,[-5,-4,-2,-11.5,1,-4]);ctx.fill();ctx.fillStyle=bio;ctx.beginPath();ctx.arc(-2,-11.5,1.6,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#2a1430';ctx.beginPath();ctx.arc(8.2,0,5,0,Math.PI*2);ctx.fill();ctx.shadowColor=bio;ctx.shadowBlur=7;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(9.6,-2.8,1.6,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(11.2,0,1.7,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(9.6,2.8,1.6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='tank'){
      ctx.fillStyle='#3a1830';ctx.fillRect(-12,-14,6,4);ctx.fillRect(-12,10,6,4);ctx.fillRect(4,-13.5,6,4);ctx.fillRect(4,9.5,6,4);
      ctx.fillStyle='#2a1430';ctx.beginPath();ctx.ellipse(0,0,16,12.5,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='#ff7a45';ctx.beginPath();ctx.ellipse(3,0,12,8.6,0,0,Math.PI*2);ctx.fill();
      for(const s of[-1,1]){ctx.fillStyle=bone;ctx.beginPath();ctx.moveTo(0,8*s);ctx.quadraticCurveTo(6,13*s,12,19*s);ctx.quadraticCurveTo(13.5,16.5*s,13,15*s);ctx.quadraticCurveTo(8,11*s,4,7*s);ctx.closePath();ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=1.2;ctx.stroke();}
      ctx.fillStyle=maw;ctx.beginPath();ctx.ellipse(13.5,0,3,4.8,0,0,Math.PI*2);ctx.fill();ctx.shadowColor=bio;ctx.shadowBlur=8;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(8,0,3.2+pulse,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='medic'){
      const pr=9+pulse;ctx.fillStyle='#4a2040';ctx.beginPath();ctx.ellipse(0,0,pr,pr*0.72,0,0,Math.PI*2);ctx.fill();
      for(let i=0;i<6;i++){const a=(i*Math.PI*2)/6+t*0.6;ctx.fillStyle='#6a2a40';ctx.beginPath();ctx.ellipse(Math.cos(a)*7.5,Math.sin(a)*5,3.4,1.9,a,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle='#ff7a45';ctx.beginPath();ctx.arc(0,0,4.4,0,Math.PI*2);ctx.fill();ctx.shadowColor=bio;ctx.shadowBlur=7;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(0,0,2.4+pulse*0.6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='flamer'){
      ctx.fillStyle='#2a1430';ctx.beginPath();ctx.ellipse(0,0,12.5,8.5,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=1.8;ctx.stroke();
      ctx.fillStyle='#ff7a45';ctx.beginPath();ctx.ellipse(0,0,8.5,5.2,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=maw;ctx.beginPath();ctx.arc(9.5,0,5.2,0,Math.PI*2);ctx.fill();
      ctx.shadowColor=bio;ctx.shadowBlur=8;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(9.5,0,2.2+pulse,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='scout'){
      ctx.fillStyle='#2a1430';ctx.beginPath();ctx.ellipse(0,0,9.5,6.4,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=1.6;ctx.stroke();
      ctx.fillStyle='#ff7a45';ctx.beginPath();ctx.ellipse(0,0,5.8,3.6,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=maw;ctx.beginPath();ctx.arc(7.5,0,4.2,0,Math.PI*2);ctx.fill();
      ctx.shadowColor=bio;ctx.shadowBlur=7;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(7.5,0,1.8+pulse*0.7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle=bone;poly(ctx,[7.5,-2,10.5,-1,7.5,0]);ctx.fill();poly(ctx,[7.5,2,10.5,1,7.5,0]);ctx.fill();
    } else {
      ctx.fillStyle='#4a1030';ctx.beginPath();ctx.ellipse(0,0,13.5,10.5,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=1.8;ctx.stroke();
      ctx.fillStyle='#ff7a45';ctx.beginPath();ctx.ellipse(2,0,8.5,5.8,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=maw;ctx.beginPath();ctx.arc(10.5,0,4.2,0,Math.PI*2);ctx.fill();
      ctx.shadowColor=bio;ctx.shadowBlur=7;ctx.fillStyle=bio;ctx.beginPath();ctx.arc(10.5,0,2.2+pulse,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    }
  } else {
    ctx.fillStyle=main;ctx.globalAlpha=0.12+0.09*eng*flick;ctx.beginPath();ctx.ellipse(0,4,u.r+3,u.r*0.62,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    if(u.type==='worker'){
      ctx.fillStyle=hull;ctx.fillRect(-9,-11,6,3.4);ctx.fillRect(-9,7.6,6,3.4);ctx.fillRect(3,-11,6,3.4);ctx.fillRect(3,7.6,6,3.4);
      ctx.fillStyle=main;ctx.globalAlpha=0.6+0.4*flick*eng;ctx.fillRect(-8,-10.6,4,2.4);ctx.fillRect(-8,8.2,4,2.4);ctx.fillRect(4,-10.6,4,2.4);ctx.fillRect(4,8.2,4,2.4);ctx.globalAlpha=1;
      ctx.strokeStyle=hull2;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(6,-5);ctx.lineTo(12,-7+step);ctx.stroke();ctx.beginPath();ctx.moveTo(6,5);ctx.lineTo(12,7-step);ctx.stroke();
      ctx.strokeStyle=amber;ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(12,-7+step);ctx.lineTo(14.5,-8+step);ctx.stroke();ctx.beginPath();ctx.moveTo(12,7-step);ctx.lineTo(14.5,8-step);ctx.stroke();
      ctx.fillStyle=hull;poly(ctx,[11,0,5,-9,-6,-9,-11,0,-6,9,5,9]);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.4;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle=hull2;poly(ctx,[7,0,3,-5,-4,-5,-7,0,-4,5,3,5]);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(-4,-5);ctx.lineTo(3,-5);ctx.stroke();ctx.beginPath();ctx.moveTo(-4,5);ctx.lineTo(3,5);ctx.stroke();
      ctx.strokeStyle=hull2;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-6,-8);ctx.lineTo(-6,-12);ctx.stroke();ctx.fillStyle=amber;ctx.globalAlpha=0.4+0.6*(0.5+0.5*Math.sin(t*6));ctx.beginPath();ctx.arc(-6,-13,2.2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
      ctx.shadowColor=bright;ctx.shadowBlur=7;ctx.fillStyle=bright;ctx.beginPath();ctx.arc(2,0,2.8+pulse,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='marine'){
      ctx.fillStyle=main;ctx.globalAlpha=0.5+0.5*flick*eng;ctx.fillRect(-5,-10.6,5,2.4);ctx.fillRect(-5,8.2,5,2.4);ctx.globalAlpha=1;ctx.fillStyle=hull2;ctx.fillRect(-13.5,-4,3,8);
      const bl=13-recoil*3.5;ctx.fillStyle='#0a1418';ctx.fillRect(6,-1.9,bl,3.8);ctx.fillStyle=hull2;ctx.fillRect(6+bl-2.5,-2.8,2.5,5.6);if(recoil>0.55){ctx.fillStyle=heat;ctx.beginPath();ctx.arc(6+bl+1.5,0,2.6,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle=hull;poly(ctx,[8,0,3,-9,-8,-9,-11,0,-8,9,3,9]);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.4;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle=hull2;poly(ctx,[4,0,0,-6,-6,-6,-8,0,-6,6,0,6]);ctx.fill();ctx.fillStyle=amber;ctx.fillRect(-10,-11.5,6,3.6);ctx.fillRect(-10,7.9,6,3.6);ctx.strokeStyle=outline;ctx.lineWidth=1;ctx.strokeRect(-10,-11.5,6,3.6);ctx.strokeRect(-10,7.9,6,3.6);
      ctx.shadowColor=bright;ctx.shadowBlur=7;ctx.fillStyle=bright;ctx.fillRect(-1,-1.4+sway*0.4,6.5,2.8);ctx.shadowBlur=0;
    } else if(u.type==='buggy'){
      const fl=(5+9*flick)*eng;ctx.fillStyle=heat;ctx.globalAlpha=0.85;poly(ctx,[-12,-7.5,-12-fl,-5.5,-12,-3.5]);ctx.fill();poly(ctx,[-12,7.5,-12-fl,5.5,-12,3.5]);ctx.fill();ctx.globalAlpha=1;
      ctx.fillStyle=hull;ctx.fillRect(-13,-8.5,4,5);ctx.fillRect(-13,3.5,4,5);ctx.fillStyle=hull;poly(ctx,[15,0,-6,-11,-11,-11,-3,0,-11,11,-6,11]);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.4;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.strokeStyle=main;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(11,-1.5);ctx.lineTo(-5,-9);ctx.stroke();ctx.beginPath();ctx.moveTo(11,1.5);ctx.lineTo(-5,9);ctx.stroke();
      ctx.fillStyle=main;ctx.fillRect(-9,-1.4,14,2.8);ctx.fillStyle=hull2;ctx.beginPath();ctx.ellipse(4,0,5,3.4,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=bright;ctx.globalAlpha=0.9;ctx.beginPath();ctx.ellipse(5,-0.6,2.6,1.4,-0.2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
      ctx.fillStyle='#0a1418';ctx.fillRect(11,-3.6,6.5-recoil*2,1.7);ctx.fillRect(11,1.9,6.5-recoil*2,1.7);ctx.shadowColor=bright;ctx.shadowBlur=7;ctx.fillStyle=bright;ctx.beginPath();ctx.arc(-4,0,2.2+pulse*0.7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='tank'){
      ctx.fillStyle=hull;ctx.fillRect(-15,-15,24,5);ctx.fillRect(-15,10,24,5);ctx.fillStyle=main;ctx.globalAlpha=0.5+0.5*flick*eng;ctx.fillRect(-13,-14.2,20,3.2);ctx.fillRect(-13,11,20,3.2);ctx.globalAlpha=1;
      ctx.fillStyle=hull;rr(ctx,-14,-11,28,22,6);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.4;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle=hull2;poly(ctx,[14,-8,19.5,0,14,8]);ctx.fill();ctx.strokeStyle=amber;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(15,-5);ctx.lineTo(18,0);ctx.lineTo(15,5);ctx.stroke();
      ctx.fillStyle=hull2;rr(ctx,-9,-7,18,14,5);ctx.fill();ctx.strokeStyle=outline;ctx.lineWidth=1.6;ctx.stroke();ctx.fillStyle=main;ctx.beginPath();ctx.arc(-6,-4.5,1.4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(-6,4.5,1.4,0,Math.PI*2);ctx.fill();
      const bl2=15-recoil*4;ctx.fillStyle='#0a1418';ctx.fillRect(7,-5.6,bl2,3.4);ctx.fillRect(7,2.2,bl2,3.4);ctx.fillStyle=main;ctx.fillRect(7+bl2-2.5,-6.4,2.5,5);ctx.fillRect(7+bl2-2.5,1.4,2.5,5);if(recoil>0.5){ctx.fillStyle=heat;ctx.beginPath();ctx.arc(7+bl2+1.5,-3.9,2.4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(7+bl2+1.5,3.9,2.4,0,Math.PI*2);ctx.fill();}
      ctx.shadowColor=bright;ctx.shadowBlur=7;ctx.fillStyle=bright;ctx.beginPath();ctx.arc(-3,0,2.8+pulse*0.8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle=amber;ctx.fillRect(-15.5,-4,2.2,3);ctx.fillRect(-15.5,1,2.2,3);
    } else if(u.type==='medic'){
      ctx.fillStyle=main;ctx.globalAlpha=0.55+0.45*flick;ctx.fillRect(-13.5,-2.6,3.4,5.2);ctx.fillRect(10.1,-2.6,3.4,5.2);ctx.fillRect(-2.6,-13.5,5.2,3.4);ctx.fillRect(-2.6,10.1,5.2,3.4);ctx.globalAlpha=1;
      ctx.fillStyle=hull;ctx.beginPath();ctx.arc(0,0,10.4,0,Math.PI*2);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.4;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.strokeStyle=main;ctx.lineWidth=2.4;ctx.beginPath();ctx.arc(0,0,7.6,t*0.8,t*0.8+Math.PI*1.5);ctx.stroke();ctx.fillStyle=hull2;ctx.beginPath();ctx.arc(0,0,4.8,0,Math.PI*2);ctx.fill();
      const cw2=1.8+pulse*0.5;ctx.shadowColor=bright;ctx.shadowBlur=7;ctx.fillStyle=bright;ctx.fillRect(-cw2/2,-6.4,cw2,12.8);ctx.fillRect(-6.4,-cw2/2,12.8,cw2);ctx.shadowBlur=0;
      ctx.strokeStyle=hull2;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(-7,-7);ctx.lineTo(-10,-10);ctx.stroke();ctx.fillStyle=amber;ctx.beginPath();ctx.arc(-10.5,-10.5,1.6,0,Math.PI*2);ctx.fill();
    } else if(u.type==='flamer'){
      ctx.fillStyle='#4a2c22';rr(ctx,-12,-11,11,4,2);ctx.fill();rr(ctx,-12,7,11,4,2);ctx.fill();ctx.fillStyle=amber;ctx.fillRect(-12.5,-10.4,2.4,2.8);ctx.fillRect(-12.5,7.6,2.4,2.8);ctx.fillRect(-3.5,-10.4,2.4,2.8);ctx.fillRect(-3.5,7.6,2.4,2.8);
      ctx.fillStyle=hull;rr(ctx,-11,-8,19,16,5);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.2;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=hull2;poly(ctx,[8,-8,13.5,-5,13.5,5,8,8]);ctx.fill();
      ctx.fillStyle=bright;ctx.fillRect(-3,-5.5,7,2);ctx.fillRect(-3,3.5,7,2);ctx.strokeStyle=main;ctx.lineWidth=1.2;for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-9+i*3,-7);ctx.lineTo(-9+i*3,-4);ctx.stroke();ctx.beginPath();ctx.moveTo(-9+i*3,4);ctx.lineTo(-9+i*3,7);ctx.stroke();}
      ctx.fillStyle='#0a1418';poly(ctx,[13,-4.6,18.5,-2.8,18.5,2.8,13,4.6]);ctx.fill();ctx.shadowColor=heat;ctx.shadowBlur=9;ctx.fillStyle=heat;ctx.beginPath();ctx.arc(18.5,0,1.8+heatGlow*2.6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if(u.type==='scout'){
      ctx.fillStyle=hull;poly(ctx,[12,0,-8,-8,-4,0,-8,8]);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.2;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.strokeStyle=main;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-6,-6);ctx.moveTo(9,0);ctx.lineTo(-6,6);ctx.stroke();ctx.fillStyle=bright;ctx.beginPath();ctx.arc(2,0,2.6,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=hull2;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(-6,0);ctx.lineTo(-6,-10);ctx.stroke();ctx.fillStyle=amber;ctx.beginPath();ctx.arc(-6,-11,1.7+pulse*0.7,0,Math.PI*2);ctx.fill();
      const dx2=10+Math.sin(t*2.2)*2, dy2=-8+Math.cos(t*3.1)*1.6;ctx.strokeStyle=bright;ctx.lineWidth=1;ctx.globalAlpha=0.55;ctx.beginPath();ctx.moveTo(2,0);ctx.lineTo(dx2,dy2);ctx.stroke();ctx.globalAlpha=1;ctx.shadowColor=bright;ctx.shadowBlur=6;ctx.fillStyle=bright;ctx.beginPath();ctx.arc(dx2,dy2,1.9,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      ctx.fillStyle=heat;ctx.globalAlpha=0.7;poly(ctx,[-8,-3,-8-4*eng,0,-8,3]);ctx.fill();ctx.globalAlpha=1;
    } else {
      ctx.fillStyle=hull;ctx.fillRect(-16,-13,28,4.6);ctx.fillRect(-16,8.4,28,4.6);ctx.fillStyle=main;ctx.globalAlpha=0.5+0.5*flick*eng;for(let i=0;i<3;i++){ctx.fillRect(-14+i*8,-12.4,5,3.2);ctx.fillRect(-14+i*8,9.2,5,3.2);}ctx.globalAlpha=1;
      ctx.strokeStyle=hull2;ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(-14,-7);ctx.lineTo(-19,-11);ctx.stroke();ctx.beginPath();ctx.moveTo(-14,7);ctx.lineTo(-19,11);ctx.stroke();
      ctx.fillStyle=hull;rr(ctx,-14,-7.5,26,15,4);ctx.fill();ctx.strokeStyle=hullHi;ctx.lineWidth=1.2;ctx.stroke();ctx.strokeStyle=outline;ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle=hull2;ctx.beginPath();ctx.arc(-9,0,5,0,Math.PI*2);ctx.fill();ctx.fillStyle=amber;for(let i=0;i<3;i++){const a=t*0.7+(i*Math.PI*2)/3;ctx.beginPath();ctx.arc(-9+Math.cos(a)*2.8,Math.sin(a)*2.8,1.3,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle=hull2;ctx.beginPath();ctx.arc(2,0,6.6,0,Math.PI*2);ctx.fill();ctx.strokeStyle=main;ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(2,0,6.6,0,Math.PI*2);ctx.stroke();
      const bl3=23-recoil*5;ctx.fillStyle='#0a1418';ctx.fillRect(4,-2.1,bl3,4.2);ctx.fillStyle=main;ctx.fillRect(4+bl3-3,-3.1,3,6.2);if(recoil>0.5){ctx.fillStyle=heat;ctx.beginPath();ctx.arc(4+bl3+1.5,0,2.8,0,Math.PI*2);ctx.fill();}
      ctx.shadowColor=amber;ctx.shadowBlur=7;ctx.fillStyle=amber;ctx.beginPath();ctx.arc(2,0,2+pulse*0.7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    }
  }
  if(u.carrying>0){ctx.shadowColor=COLORS.mineral;ctx.shadowBlur=8;ctx.fillStyle=COLORS.mineral;poly(ctx,[-10,-3,-6,-8.5,-2,-3,-6,2.5]);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='rgba(255,255,255,0.75)';poly(ctx,[-6,-8.5,-4.4,-3.4,-6,-1]);ctx.fill();}
  ctx.fillStyle=bright;ctx.globalAlpha=0.95;ctx.fillRect(u.r*0.45,-1.2,3.5,2.4);ctx.globalAlpha=1;
  if(u.flashT>0){ctx.fillStyle=`rgba(255,255,255,${u.flashT*2.8})`;ctx.beginPath();ctx.arc(0,0,u.r+2,0,Math.PI*2);ctx.fill();}
  ctx.restore();
  if(u.selected&&u.idleReason==='unreachable'){ctx.font='bold 13px system-ui, sans-serif';ctx.textAlign='center';ctx.fillStyle='#ff6a5e';ctx.fillText('!',rx+u.r+6,ry-u.r-2);ctx.textAlign='left';}
  if(u.selected||u.hp<u.maxHp){const w=u.cfg.vehicle?34:25,x0=rx-w/2,y0=ry-u.r-12,frac=Math.max(0,u.hp/u.maxHp);ctx.fillStyle='rgba(4,15,19,0.88)';ctx.fillRect(x0-1,y0-1,w+2,6);ctx.fillStyle=frac<0.33?'#ff806e':isP?'#8cedcc':'#ffb078';ctx.fillRect(x0,y0,w*frac,4);}
}
