// S2 sprite loader — тянет PNG из assets/s2/ (вырезаны из концепта 1:1) и отдаёт drawUnitS2/drawBuildingS2 через drawImage
// Качество = качество картинки, не процедурный Canvas. Сохраняет анимацию через scale/alpha.
const unitCache=new Map(), buildingCache=new Map();
function load(src){ const img=new Image(); img.src=src; return img; }
const unitTypes=['worker','marine','buggy','tank','medic','flamer','scout','mortar'];
const buildingTypes=['cc','depot','barracks','turret','wall','bunker','factory','lab'];
for(const t of unitTypes){ unitCache.set(`human_${t}`, load(`./assets/s2/units/human_${t}.png`)); unitCache.set(`alien_${t}`, load(`./assets/s2/units/alien_${t}.png`)); }
for(const t of buildingTypes){ buildingCache.set(`human_${t}`, load(`./assets/s2/buildings/human_${t}.png`)); buildingCache.set(`alien_${t}`, load(`./assets/s2/buildings/alien_${t}.png`)); }

export function drawUnitS2(ctx,u,rx,ry){
  const key=`${u.faction}_${u.type}`;
  const img=unitCache.get(key);
  if(!img||!img.complete||!img.naturalWidth){ // fallback — старый процедурный S1
    ctx.fillStyle='rgba(0,8,13,0.47)'; ctx.beginPath(); ctx.ellipse(rx,ry+6,u.r+3,u.r*0.55,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=u.side==='player'?'#7df3e2':'#ff806e'; ctx.beginPath(); ctx.arc(rx,ry,8,0,Math.PI*2); ctx.fill();
    return;
  }
  const t=performance.now()*0.001+u.id*1.618, pulse=0.5+0.5*Math.sin(t*2.85), flick=0.72+0.28*Math.sin(t*23+u.id), step=u.moving?Math.sin(t*14):0;
  const scale=0.28 + pulse*0.04, alpha=0.9+0.1*flick, sway=Math.sin(t*2.1)*1.5;
  const S=170; // исходный размер клетки концепта
  const drawW=S*scale, drawH=S*scale;
  ctx.save(); ctx.translate(rx,ry); ctx.rotate(u.angle); ctx.globalAlpha=alpha;
  // тень под спрайтом
  ctx.fillStyle='rgba(0,8,13,0.45)'; ctx.beginPath(); ctx.ellipse(0,6, u.r+4, u.r*0.5,0,0,Math.PI*2); ctx.fill();
  // лёгкое покачивание шага
  ctx.translate(sway*0.5, step*0.8);
  ctx.drawImage(img, -drawW/2, -drawH/2-4, drawW, drawH);
  // фракционная кромка для 0.2с читаемости поверх спрайта
  ctx.fillStyle=u.side==='player'?'#7df3e2':'#ff806e'; ctx.globalAlpha=0.95; ctx.fillRect(u.r*0.45,-1.2,3.5,2.4); ctx.globalAlpha=1;
  ctx.restore();
  // HP и эффекты как в S1
  if(u.selected){ ctx.strokeStyle=u.side==='player'?'#c5fff1':'#ffd0b5'; ctx.lineWidth=1.8; ctx.beginPath(); ctx.ellipse(rx,ry+2,u.r+6,u.r+4,0,0,Math.PI*2); ctx.stroke(); }
  if(u.selected||u.hp<u.maxHp){ const w=u.cfg.vehicle?34:25,x0=rx-w/2,y0=ry-u.r-12,frac=Math.max(0,u.hp/u.maxHp); ctx.fillStyle='rgba(4,15,19,0.88)';ctx.fillRect(x0-1,y0-1,w+2,6); ctx.fillStyle=frac<0.33?'#ff806e':u.side==='player'?'#8cedcc':'#ffb078'; ctx.fillRect(x0,y0,w*frac,4); }
}
export function drawBuildingS2(ctx,b,ghost=false,camX=0,camY=0){
  const TILE_W=32, px=b.tx*TILE_W-camX, py=b.ty*TILE_W-camY, w=b.w*TILE_W, h=b.h*TILE_W, cx=px+w/2, cy=py+h/2;
  const key=`${b.faction}_${b.type}`, img=buildingCache.get(key);
  if(!img||!img.complete||!img.naturalWidth){ // fallback
    ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(px,py,w,h); return;
  }
  ctx.save();
  // тень
  ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(cx, py+h+8, w*0.4, 10,0,0,Math.PI*2); ctx.fill();
  // спрайт — вписываем в футпринт с сохранением пропорций
  const pad=6, availW=w-pad*2, availH=h-pad*2;
  const scale=Math.min(availW/img.naturalWidth, availH/img.naturalHeight)*0.92;
  const drawW=img.naturalWidth*scale, drawH=img.naturalHeight*scale;
  ctx.drawImage(img, cx-drawW/2, cy-drawH/2, drawW, drawH);
  // фракционная кромка крыши
  if(!ghost && b.done!==false){ ctx.fillStyle=b.faction==='human'?'#7df3e2':'#8aff9e'; ctx.globalAlpha=0.92; ctx.fillRect(cx-w*0.42, py+6, w*0.84, 1.6); ctx.globalAlpha=1; }
  ctx.restore();
  // прогресс/HP как в оригинале (упрощённо)
  if(b.done===false && !ghost){ ctx.strokeStyle='rgba(243,197,121,0.85)'; ctx.lineWidth=2; ctx.setLineDash([7,5]); ctx.strokeRect(px+3,py+3,w-6,h-6); ctx.setLineDash([]); }
  if(b.hp<b.maxHp && b.done!==false){ const frac=Math.max(0,b.hp/b.maxHp); ctx.fillStyle='rgba(8,10,12,0.7)'; ctx.fillRect(px,py-11,w,6); ctx.fillStyle=frac>0.55?'#7BE495':frac>0.28?'#f3c579':'#ff6e5f'; ctx.fillRect(px+1,py-10,(w-2)*frac,4); }
}
