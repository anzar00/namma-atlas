// Geographic compatibility renderer. Web Mercator imagery and metro coordinates
// share an axonometric camera; all vertical station dimensions are illustrative.
const RAD=Math.PI/180;
const mercator=c=>[(c[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+c[1]*RAD/2))/Math.PI)/2];
const geographic=c=>[c[0]*360-180,Math.atan(Math.sinh(Math.PI*(1-2*c[1])))/RAD];
export class CanvasAtlas {
  constructor(container,options,handlers){
    this.isFallback=true;this.container=container;this.camera={center:options.center,zoom:options.zoom,pitch:options.pitch,bearing:options.bearing,padding:{top:0,bottom:0,left:0,right:0}};this.handlers=handlers;this.tiles=new Map();this.hitStations=[];this.hitRoutes=[];this.pending=false;this.data=null;
    this.canvas=document.createElement('canvas');this.canvas.className='atlas-compatibility-canvas';this.canvas.setAttribute('aria-label','Interactive geographic metro map; drag to pan, scroll to zoom, right-drag to rotate and tilt');this.canvas.tabIndex=0;container.replaceChildren(this.canvas);this.ctx=this.canvas.getContext('2d');
    this.credit=document.createElement('div');this.credit.className='compatibility-attribution';this.credit.innerHTML='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';container.append(this.credit);
    this.scale=document.createElement('div');this.scale.className='compatibility-scale';container.append(this.scale);
    this.resize=new ResizeObserver(()=>this.schedule());this.resize.observe(container);this.attach();this.schedule();
  }
  renderData(data){this.data=data;this.schedule();}
  getCenter(){return{lng:this.camera.center[0],lat:this.camera.center[1]};}getZoom(){return this.camera.zoom;}getPitch(){return this.camera.pitch;}getBearing(){return this.camera.bearing;}
  zoomIn(){this.easeTo({zoom:this.camera.zoom+.7});}zoomOut(){this.easeTo({zoom:this.camera.zoom-.7});}
  jumpTo(opts){this.easeTo({...opts,duration:0});}
  easeTo(opts){
    if(opts.zoom!==undefined)this.camera.zoom=Math.max(9,Math.min(18.5,opts.zoom));if(opts.center)this.camera.center=opts.center;
    if(opts.pitch!==undefined)this.camera.pitch=opts.pitch;if(opts.bearing!==undefined)this.camera.bearing=opts.bearing;if(opts.padding)this.camera.padding=opts.padding;
    this.handlers.onMove?.();this.schedule();
  }
  fitBounds(bounds,opts={}){
    const b=bounds.toArray(),lo=mercator([b[0][0],b[1][1]]),hi=mercator([b[1][0],b[0][1]]);const p=opts.padding||{top:70,bottom:110,left:60,right:60};
    const availableW=Math.max(80,this.container.clientWidth-p.left-p.right),availableH=Math.max(100,this.container.clientHeight-p.top-p.bottom);
    const bearing=(opts.bearing||0)*RAD,pitch=(opts.pitch||0)*RAD;const dx=Math.abs(hi[0]-lo[0]),dy=Math.abs(hi[1]-lo[1]);const rotatedW=dx*Math.abs(Math.cos(bearing))+dy*Math.abs(Math.sin(bearing)),rotatedH=(dx*Math.abs(Math.sin(bearing))+dy*Math.abs(Math.cos(bearing)))*Math.cos(pitch);
    const zoom=Math.min(Math.log2(availableW/(256*rotatedW)),Math.log2(availableH/(256*rotatedH)),opts.maxZoom||18);
    this.easeTo({center:geographic([(lo[0]+hi[0])/2,(lo[1]+hi[1])/2]),zoom,padding:p,pitch:opts.pitch||0,bearing:opts.bearing||0});
  }
  transform(){const c=this.camera,p=c.padding||{},w=this.container.clientWidth,h=this.container.clientHeight;return{w,h,x:(w+(p.left||0)-(p.right||0))/2,y:(h+(p.top||0)-(p.bottom||0))/2,world:256*2**c.zoom,center:mercator(c.center),cos:Math.cos(c.bearing*RAD),sin:Math.sin(c.bearing*RAD),tilt:Math.cos(c.pitch*RAD)};}
  project(coords,height=0){const t=this.transform(),p=mercator(coords),dx=(p[0]-t.center[0])*t.world,dy=(p[1]-t.center[1])*t.world,vertical=height*t.world/(40075017*Math.cos(coords[1]*RAD))*Math.sin(this.camera.pitch*RAD);return[t.x+dx*t.cos-dy*t.sin,t.y+(dx*t.sin+dy*t.cos)*t.tilt-vertical];}
  unproject(x,y){const t=this.transform(),dx=x-t.x,dy=(y-t.y)/t.tilt;return geographic([t.center[0]+(dx*t.cos+dy*t.sin)/t.world,t.center[1]+(-dx*t.sin+dy*t.cos)/t.world]);}
  schedule(){if(this.pending)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.draw();});}
  tile(z,x,y){const id=`${z}/${x}/${y}`;if(this.tiles.has(id))return this.tiles.get(id);const image=new Image();image.crossOrigin='anonymous';const entry={image,ready:false};this.tiles.set(id,entry);image.onload=()=>{entry.ready=true;this.schedule();};image.onerror=()=>{entry.failed=true;};image.src=`https://tile.openstreetmap.org/${id}.png`;return entry;}
  draw(){
    const t=this.transform(),ctx=this.ctx,dpr=Math.min(devicePixelRatio||1,2);if(this.canvas.width!==t.w*dpr||this.canvas.height!==t.h*dpr){this.canvas.width=t.w*dpr;this.canvas.height=t.h*dpr;this.canvas.style.width=t.w+'px';this.canvas.style.height=t.h+'px';}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#172b22';ctx.fillRect(0,0,t.w,t.h);
    const z=Math.floor(this.camera.zoom),count=2**z,scale=2**(this.camera.zoom-z),size=256*scale;
    const corners=[[0,0],[t.w,0],[0,t.h],[t.w,t.h]].map(p=>mercator(this.unproject(...p)));const minX=Math.floor(Math.min(...corners.map(p=>p[0]))*count)-1,maxX=Math.ceil(Math.max(...corners.map(p=>p[0]))*count),minY=Math.floor(Math.min(...corners.map(p=>p[1]))*count)-1,maxY=Math.ceil(Math.max(...corners.map(p=>p[1]))*count);
    ctx.save();ctx.filter='invert(1) hue-rotate(165deg) saturate(.25) brightness(.72)';ctx.translate(t.x,t.y);ctx.transform(t.cos,t.sin*t.tilt,-t.sin,t.cos*t.tilt,0,0);
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){if(y<0||y>=count)continue;const tile=this.tile(z,x,y);const px=x*size-t.center[0]*t.world,py=y*size-t.center[1]*t.world;if(tile.ready){ctx.drawImage(tile.image,px,py,size+.5,size+.5);}else{ctx.fillStyle='#1a2c23';ctx.fillRect(px,py,size+.5,size+.5);}}
    ctx.restore();ctx.fillStyle='rgba(25,62,34,.2)';ctx.fillRect(0,0,t.w,t.h);
    if(!this.data)return;const{state,lines,stations,routeFeatures,stationFeatures}=this.data;const visible=lines.filter(l=>(state.filter==='all'||state.filter===l.status)&&(state.expansion||l.status==='operational')).map(l=>l.id);const selected=state.selected;
    this.hitRoutes=[];this.hitStations=[];
    for(const f of routeFeatures){const p=f.properties;if(!visible.includes(p.lineId))continue;const points=f.geometry.coordinates.map(c=>this.project(c));const alpha=(selected&&p.lineId!==selected) ? .12 : 1;
      ctx.globalAlpha=alpha;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);const path=()=>{ctx.beginPath();points.forEach((c,i)=>i?ctx.lineTo(...c):ctx.moveTo(...c));};
      path();ctx.strokeStyle='#0b1f13';ctx.lineWidth=6.5;ctx.stroke();
      if(this.camera.pitch>10&&this.camera.zoom>=13.5){const upper=f.geometry.coordinates.map(c=>this.project(c,p.section==='underground'?3:23));ctx.strokeStyle=p.color;ctx.lineWidth=5;ctx.globalAlpha=alpha*.28;path();ctx.stroke();ctx.globalAlpha=alpha;ctx.beginPath();upper.forEach((c,i)=>i?ctx.lineTo(...c):ctx.moveTo(...c));ctx.lineWidth=3;ctx.strokeStyle=p.color;ctx.stroke();}
      path();ctx.strokeStyle=p.color;ctx.lineWidth=this.camera.zoom<12?2.6:3.4;ctx.setLineDash(p.status==='operational'?[]:p.status==='proposed'?[2,6]:[8,5]);ctx.stroke();ctx.setLineDash([]);this.hitRoutes.push({lineId:p.lineId,points});
    }
    ctx.globalAlpha=1;const labels=[];
    const ordered=[...stationFeatures].sort((a,b)=>a.geometry.coordinates[1]-b.geometry.coordinates[1]).reverse();
    for(const f of ordered){const st=stations.find(s=>s.id===f.properties.id);const available=st.lines.filter(l=>visible.includes(l));if(!available.length)continue;const lid=selected&&available.includes(selected)?selected:available[0];const line=lines.find(l=>l.id===lid);const point=this.project(st.coordinates);if(point[0]<-30||point[0]>t.w+30||point[1]<-60||point[1]>t.h+20)continue;
      const alpha=(selected&&lid!==selected) ? .18 : 1;ctx.globalAlpha=alpha;const interchange=st.lines.filter(l=>['purple','green','yellow'].includes(l)).length>1;const r=interchange?5:this.camera.zoom>13?3.8:2.7;
      let labelPoint=point;
      if(this.camera.pitch>10&&this.camera.zoom>=13){const roof=this.project(st.coordinates,st.lines.length>1?80:42),rw=Math.max(4,Math.min(13,(2**(this.camera.zoom-13))*4));
        ctx.fillStyle=line.color+'70';ctx.strokeStyle=line.color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(point[0]-rw,point[1]);ctx.lineTo(roof[0]-rw,roof[1]);ctx.lineTo(roof[0]+rw,roof[1]);ctx.lineTo(point[0]+rw,point[1]);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.ellipse(roof[0],roof[1],rw,rw*t.tilt,0,0,Math.PI*2);ctx.fillStyle=line.color;ctx.fill();labelPoint=roof;}
      ctx.beginPath();ctx.arc(point[0],point[1],r,0,2*Math.PI);ctx.fillStyle=interchange?'#e5ecd7':'#192d20';ctx.fill();ctx.lineWidth=interchange?1.4:1.5;ctx.strokeStyle=interchange?'#39512d':line.color;ctx.stroke();
      this.hitStations.push({id:st.id,lineId:lid,point});
      if(state.labels&&this.camera.zoom>=11.4&&alpha>.5)labels.push({name:st.name,point:labelPoint,priority:interchange?0:(selected&&lid===selected?1:2)});
    }
    ctx.globalAlpha=1;const occupied=[];ctx.font=`${this.camera.zoom>=14?11:9}px DM,Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='top';
    for(const label of labels.sort((a,b)=>a.priority-b.priority)){const p=label.point,width=ctx.measureText(label.name).width+8,rect=[p[0]-width/2,p[1]+9,width,16];if(occupied.some(r=>rect[0]<r[0]+r[2]&&rect[0]+rect[2]>r[0]&&rect[1]<r[1]+r[3]&&rect[1]+rect[3]>r[1]))continue;occupied.push(rect);ctx.strokeStyle='#14291b';ctx.lineWidth=3;ctx.strokeText(label.name,p[0],p[1]+9);ctx.fillStyle='#b7c7a3';ctx.fillText(label.name,p[0],p[1]+9);}
    const meters=40075017*Math.cos(this.camera.center[1]*RAD)/t.world;const scaleDistance=meters*70;const unit=scaleDistance>1500?1000:scaleDistance>800?500:scaleDistance>300?200:100;const rounded=Math.max(unit,Math.floor(scaleDistance/unit)*unit);this.scale.textContent=rounded>=1000?(rounded/1000)+' km':rounded+' m';this.scale.style.width=Math.max(30,rounded/meters)+'px';this.updatePopup();
  }
  showPopup(coords,html){this.popup?.remove();const element=document.createElement('div');element.className='compatibility-popup';element.innerHTML='<button class="compatibility-popup-close" aria-label="Close station details">×</button>'+html;this.container.append(element);const result={remove:()=>{element.remove();if(this.popup?.element===element)this.popup=null;},element,coords};this.popup=result;element.querySelector('.compatibility-popup-close').onclick=result.remove;this.updatePopup();return result;}
  updatePopup(){if(!this.popup)return;const p=this.project(this.popup.coords);const e=this.popup.element;const w=e.offsetWidth,h=e.offsetHeight;const screenW=this.container.clientWidth;let x=p[0]-w/2,y=p[1]-h-18;x=Math.max(12,Math.min(screenW-w-12,x));y=Math.max(72,y);e.style.left=x+'px';e.style.top=y+'px';}
  attach(){
    let drag=null;const pointers=new Map();let previousPinch=null;
    const location=e=>{const r=this.canvas.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];};
    this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    this.canvas.addEventListener('pointerdown',e=>{this.canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,location(e));drag={start:location(e),last:location(e),button:e.button,moved:false};this.canvas.style.cursor='grabbing';if(pointers.size===2)previousPinch=[...pointers.values()];});
    this.canvas.addEventListener('pointermove',e=>{
      const p=location(e);if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,p);
      if(pointers.size===2){const pair=[...pointers.values()];if(previousPinch){const distance=a=>Math.hypot(a[1][0]-a[0][0],a[1][1]-a[0][1]);const ratio=distance(pair)/Math.max(1,distance(previousPinch));const angle=a=>Math.atan2(a[1][1]-a[0][1],a[1][0]-a[0][0]);this.camera.zoom=Math.max(9,Math.min(18.5,this.camera.zoom+Math.log2(ratio)));this.camera.bearing+=(angle(pair)-angle(previousPinch))/RAD;}previousPinch=pair;this.handlers.onMove?.();this.schedule();if(drag)drag.moved=true;return;}
      if(!drag)return;const dx=p[0]-drag.last[0],dy=p[1]-drag.last[1];if(Math.hypot(p[0]-drag.start[0],p[1]-drag.start[1])>4)drag.moved=true;
      if(drag.button===2){this.camera.bearing+=dx*.35;this.camera.pitch=Math.max(0,Math.min(68,this.camera.pitch-dy*.3));this.handlers.onPitch?.(this.camera.pitch>8);}
      else{const t=this.transform(),c=mercator(this.camera.center);this.camera.center=geographic([c[0]-(dx*t.cos+dy/t.tilt*t.sin)/t.world,c[1]-(-dx*t.sin+dy/t.tilt*t.cos)/t.world]);}
      drag.last=p;this.handlers.onMove?.();this.schedule();
    });
    this.canvas.addEventListener('pointerup',e=>{const p=location(e);pointers.delete(e.pointerId);if(drag&&!drag.moved&&drag.button===0)this.pick(p);drag=null;previousPinch=null;this.canvas.style.cursor='grab';});
    this.canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);drag=null;previousPinch=null;});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();const p=location(e),before=mercator(this.unproject(...p));this.camera.zoom=Math.max(9,Math.min(18.5,this.camera.zoom-e.deltaY*.002));const after=mercator(this.unproject(...p)),c=mercator(this.camera.center);this.camera.center=geographic([c[0]+before[0]-after[0],c[1]+before[1]-after[1]]);this.handlers.onMove?.();this.schedule();},{passive:false});
    this.canvas.addEventListener('dblclick',e=>{e.preventDefault();this.easeTo({center:this.unproject(...location(e)),zoom:this.camera.zoom+1});});
    this.canvas.addEventListener('keydown',e=>{const t=this.transform(),c=mercator(this.camera.center),d=65/t.world;if(e.key==='+')this.zoomIn();else if(e.key==='-')this.zoomOut();else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();this.easeTo({center:geographic([c[0]+(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0),c[1]+(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0)])});}});
  }
  pick(p){const nearest=this.hitStations.map(s=>({...s,d:Math.hypot(s.point[0]-p[0],s.point[1]-p[1])})).sort((a,b)=>a.d-b.d)[0];if(nearest?.d<14){this.handlers.onStation(nearest.id,nearest.lineId);return;}
    let closest={distance:12};for(const route of this.hitRoutes)for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,ratio=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0,d=Math.hypot(p[0]-a[0]-ratio*dx,p[1]-a[1]-ratio*dy);if(d<closest.distance)closest={distance:d,lineId:route.lineId};}if(closest.lineId)this.handlers.onRoute(closest.lineId);
  }
}
