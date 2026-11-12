import { CanvasAtlas } from './canvas-map.js';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mobile = () => matchMedia('(max-width:650px)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const state = { filter:'all', selected:null, is3d:true, expansion:true, labels:true, buildings:true };
let network, evidence, map, popup, loaded=false;
let lines = [], stations = [], routes = [], lineById = {}, stationById = {}, sourceById = {};
let routeFeatures=[], stationFeatures=[], extrusionFeatures=[], stationExtrusions=[];
const normalizeId = id => id === 'orangewest' ? 'orange-west' : id;
const featureCollection = (features) => ({type:'FeatureCollection',features});
const pointFeature = (coordinates,properties) => ({type:'Feature',geometry:{type:'Point',coordinates},properties});
const lineFeature = (coordinates,properties) => ({type:'Feature',geometry:{type:'LineString',coordinates},properties});
function toast(message){ $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').hidden=true,4000); }
function clock(){ $('city-clock').textContent = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())+' IST'; }
clock(); setInterval(clock,60000);

async function init(){
  try {
    [network,evidence]=await Promise.all([fetch('data/network.json').then(checkResponse),fetch('data/status.json').then(checkResponse)]);
    lines=evidence.lines; lineById=Object.fromEntries(lines.map(l=>[l.id,l])); sourceById=Object.fromEntries(evidence.sources.map(s=>[s.id,s]));
    stations=network.stations.map(s=>({...s,lines:s.lines.map(normalizeId)})); stationById=Object.fromEntries(stations.map(s=>[s.id,s]));
    routes=network.routes.map(r=>({...r,id:normalizeId(r.id),line:normalizeId(r.line)}));
    routes.forEach(r=>{r.stationIds.sort((a,b)=>nearestIndex(stationById[a].coordinates,r.coordinates)-nearestIndex(stationById[b].coordinates,r.coordinates));});
    renderLines(); bindUI(); if($('station-search').value)search(); prepareFeatures(); createMap();
    const params=new URLSearchParams(location.search); const line=params.get('line'); if(lineById[line]) selectLine(line,false);
  } catch(error){ console.error(error); $('loading-panel').hidden=true; $('map-error').hidden=false; $('map-error').querySelector('b').textContent='The network could not load.'; $('retry-map').onclick=()=>location.reload(); }
}
function checkResponse(response){if(!response.ok)throw new Error('Data request failed: '+response.status);return response.json();}
function nearestIndex(c,coords){let min=Infinity,index=0;coords.forEach((p,i)=>{const d=(p[0]-c[0])**2*.95+(p[1]-c[1])**2;if(d<min){min=d;index=i;}});return index;}
function stationStatus(station,lineId){const line=lineById[lineId];if(lineId==='pink'&&station.coordinates[1]<=12.9296)return 'scheduled';return line.status;}
function statusText(status){return {operational:'In passenger service',construction:'Under construction',scheduled:'Inauguration scheduled · 13 Nov',proposed:'Proposed · not in service'}[status] || status;}
function sourceLink(id,text){const s=sourceById[id];return `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(text||s.authority)} ↗</a>`;}
function visibleLine(line){return (state.filter==='all'||state.filter===line.status)&&(state.expansion||line.status==='operational');}
function renderLines(){
  const visible=lines.filter(visibleLine);
  $('line-count').textContent=visible.length+' CORRIDOR'+(visible.length===1?'':'S');
  $('line-list').innerHTML=visible.length?visible.map(l=>`<button class="line-card ${l.status}" data-line="${l.id}" style="--color:${l.color}" aria-label="Explore ${esc(l.name)}, ${esc(l.statusLabel)}"><i class="line-dot"></i><span><span class="line-name">${esc(l.name)}<span class="length">${l.length} km</span></span><span class="route-name">${esc(l.endpoints)}</span><span class="status-label ${l.status}">${esc(l.statusLabel)}</span></span><span class="line-arrow">↗</span></button>`).join(''):'<p class="empty-list">Expansion corridors are hidden. Turn them on in Layers to see this selection.</p>';
  $('line-list').querySelectorAll('[data-line]').forEach(b=>b.onclick=()=>selectLine(b.dataset.line));
}
function renderDetail(id){
  const line=lineById[id]; const route=routes.find(r=>r.id===id); const ids=route?.stationIds||[];
  const s=sourceById[line.sourceIds[0]];
  $('route-detail').innerHTML=`<button class="back-button" id="back-network">← <span>Back to the network</span></button><div class="detail-header"><div class="eyebrow" style="color:${line.color}"><span style="width:19px;height:3px;background:currentColor;border-radius:3px"></span>${esc(line.phase.toUpperCase())}</div><h2>${esc(line.name)}</h2><p>${esc(line.endpoints)}</p><span class="status-label ${line.status}">${esc(line.statusLabel)}</span></div><div class="detail-stats"><div><strong>${line.length}<span style="font-size:11px;margin-left:4px;color:#87947a">km</span></strong><small>OFFICIAL ROUTE LENGTH</small></div><div><strong>${line.stations??'—'}</strong><small>${line.status==='operational'?'STATIONS':'PLANNED STATIONS'}</small></div></div><div class="detail-note"><b>${id==='pink'?'An opening, carefully distinguished.':'What the evidence says'}</b>${esc(line.note)}${line.progress?`<div class="progress-line"><span style="width:${line.progress.value}%"></span></div><strong>${line.progress.value.toFixed(2)}% physical progress</strong><br>${esc(line.progress.scope)}<br><strong>Measured ${esc(line.progress.asOf)} · historical</strong>`:''}<div class="evidence-date">SOURCE: ${esc(s.authority)} · ${esc(s.published)}</div>${sourceLink(line.sourceIds[0],'Read the official source')}</div>${line.sections?line.sections.map(part=>`<div class="detail-note"><b>${esc(part.name)}</b><span class="status-label ${part.status}">${esc(part.label)}</span><p style="margin:9px 0 0">${esc(part.note)}</p>${sourceLink(part.sourceId)}</div>`).join(''):''}<div class="detail-actions"><button class="primary-button" id="fit-line">Fit corridor ↗</button><button class="secondary-button" id="line-evidence">All evidence</button></div><div class="detail-heading"><span>${line.status==='operational'?'STATIONS ON THIS LINE':'MAPPED STATION POSITIONS'}</span><span>${ids.length} ON MAP</span></div>${line.status!=='operational'?`<div class="empty-list" style="padding:0 0 15px;font-size:9px">OSM names and positions are community mapped and may change. ${id==='blue'?'Bettahalasuru is absent from the OSM relation. This is not a complete official station register.':''} ${['orange','orange-west','red'].includes(id)?'Alignment is indicative, subject to engineering and approval changes.':''}</div>`:''}<div class="station-list">${ids.map(sid=>{const st=stationById[sid];const future=st.lines.some(lid=>lid!==id&&lineById[lid]?.status!=='operational'); const interchange=st.lines.length>1;return `<div class="station-row" style="--color:${line.color}"><button data-station="${esc(st.id)}">${esc(st.name)}${interchange?`<small>${future?'Future connection':'Connection'} · ${st.lines.filter(lid=>lid!==id).map(lid=>esc(lineById[lid]?.short)).join(', ')}</small>`:''}</button>${interchange?'<span class="interchange-symbol" title="Connection; check the status of each line">⇄</span>':''}</div>`;}).join('')}</div><div class="source-footnote" style="padding-bottom:15px">${esc(line.geometryNote||route?.geometryQuality||'OpenStreetMap geography.')}<br><a href="https://www.openstreetmap.org/${esc(route?.sourceId||'')}" target="_blank" rel="noopener noreferrer">View mapped alignment ↗</a></div>`;
  $('back-network').onclick=clearSelection; $('fit-line').onclick=()=>fitLine(id); $('line-evidence').onclick=()=>showSources(id);
  $('route-detail').querySelectorAll('[data-station]').forEach(b=>b.onclick=()=>openStation(b.dataset.station,id));
}
function selectLine(id,fly=true){
  state.selected=id; const line=lineById[id];
  if(!state.expansion&&line.status!=='operational'){state.expansion=true;$('show-expansion').checked=true;}
  if(state.filter!=='all'&&state.filter!==line.status)setFilter('all',false);
  $('overview-heading').hidden=true; $('filters').hidden=true; $('line-list').hidden=true; $('list-title').parentElement.hidden=true; $('route-detail').hidden=false;
  $('sidebar').classList.add('detail-open'); if(mobile())$('sidebar').classList.add('expanded');
  renderDetail(id); updateMap(); $('sidebar-inner')?.scrollTo(0,0); document.querySelector('.sidebar-inner').scrollTo(0,0);
  $('map-title').style.opacity=0; $('pink-notice').hidden=true;
  const url=new URL(location.href);url.searchParams.set('line',id);history.replaceState({},'',url);
  if(fly&&loaded)fitLine(id);
}
function clearSelection(){
  state.selected=null; if(popup)popup.remove(); $('overview-heading').hidden=false;$('filters').hidden=false;$('line-list').hidden=false;$('list-title').parentElement.hidden=false;$('route-detail').hidden=true;$('sidebar').classList.remove('detail-open');
  renderLines();updateMap();$('pink-notice').hidden=state.filter==='operational'||state.filter==='proposed'||!state.expansion;
  const url=new URL(location.href);url.searchParams.delete('line');history.replaceState({},'',url);
  if(loaded)cityView();
}
function setFilter(filter,clear=true){
  state.filter=filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-pressed',String(b.dataset.filter===filter));});
  if(clear&&state.selected)clearSelection();renderLines();updateMap();$('pink-notice').hidden=filter==='operational'||filter==='proposed'||!state.expansion;
}
function bindUI(){
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.filter));
  $('network-nav').onclick=()=>{clearSelection();if(mobile())$('sidebar').classList.remove('expanded');};
  $('status-nav').onclick=showStatus; $('sources-nav').onclick=()=>showSources();$('snapshot-button').onclick=()=>showSources();$('legend-help').onclick=showAbout;
  $('pink-notice').onclick=()=>selectLine('pink');$('close-dialog').onclick=()=>$('information-dialog').close();
  $('information-dialog').addEventListener('click',e=>{if(e.target===$('information-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  $('layers-button').onclick=()=>{const open=$('layers-panel').hidden;$('layers-panel').hidden=!open;$('layers-button').setAttribute('aria-expanded',String(open));};
  $('show-buildings').onchange=e=>{state.buildings=e.target.checked;updateMap();};
  $('show-labels').onchange=e=>{state.labels=e.target.checked;updateMap();};
  $('show-expansion').onchange=e=>{state.expansion=e.target.checked;if(state.selected&&lineById[state.selected].status!=='operational'&&!state.expansion)clearSelection();renderLines();updateMap();$('pink-notice').hidden=!state.expansion||state.selected||state.filter==='operational'||state.filter==='proposed';};
  $('view-2d').onclick=()=>set3d(false);$('view-3d').onclick=()=>set3d(true);$('zoom-in').onclick=()=>map?.zoomIn({duration:400});$('zoom-out').onclick=()=>map?.zoomOut({duration:400});
  $('compass').onclick=()=>map?.easeTo({bearing:0,duration:600});$('reset-view').onclick=()=>{if(state.selected)fitLine(state.selected);else fitNetwork();};$('retry-map').onclick=()=>location.reload();
  $('mobile-handle').onclick=()=>{$('sidebar').classList.toggle('expanded');if(state.selected&&!$('sidebar').classList.contains('expanded')){$('sidebar').classList.remove('detail-open');clearSelection();}};
  $('station-search').addEventListener('input',search);$('station-search').addEventListener('focus',()=>{if(mobile())$('sidebar').classList.add('expanded');if($('station-search').value)search();});
  $('station-search').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();$('search-results').querySelector('button')?.focus();}if(e.key==='Escape')closeSearch();if(e.key==='Enter'){e.preventDefault();$('search-results').querySelector('button')?.click();}});
  $('search-results').addEventListener('keydown',e=>{const items=[...$('search-results').querySelectorAll('button')],index=items.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();items[Math.min(index+1,items.length-1)]?.focus();}if(e.key==='ArrowUp'){e.preventDefault();if(index===0)$('station-search').focus();else items[index-1]?.focus();}if(e.key==='Escape')closeSearch();});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))closeSearch();if(!e.target.closest('.layers-panel')&&!e.target.closest('#layers-button')){$('layers-panel').hidden=true;$('layers-button').setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('information-dialog').open){e.preventDefault();$('station-search').focus();}if(e.key==='Escape')closeSearch();});
}
function search(){
  const q=$('station-search').value.trim().toLowerCase();if(q.length<1){closeSearch();return;}
  const aliases={majestic:'kempegowda','kr puram':'krishnaraja','kr pura':'krishnaraja','rv road':'rashtreeya','airport':'airport','iim':'bilekahalli'};
  const term=aliases[q]||q;
  const matchedLines=lines.filter(l=>`${l.name} ${l.endpoints}`.toLowerCase().includes(q)).slice(0,3);
  const matchedStations=stations.filter(s=>`${s.name} ${s.nameKn||''} ${s.altName||''} ${s.id}`.toLowerCase().includes(q)||s.name.toLowerCase().includes(term)).sort((a,b)=>Number(b.lines.some(l=>lineById[l].status==='operational'))-Number(a.lines.some(l=>lineById[l].status==='operational'))).slice(0,8);
  $('search-results').innerHTML=matchedLines.map(l=>`<button class="search-result" data-result-line="${l.id}"><span class="result-dot" style="--color:${l.color}"></span><span>${esc(l.name)}<small>Corridor · ${esc(l.statusLabel)}</small></span></button>`).join('')+matchedStations.map(s=>`<button class="search-result" data-result-station="${esc(s.id)}"><span class="result-dot" style="--color:${lineById[s.lines[0]].color}"></span><span>${esc(s.name)}<small>${s.lines.map(l=>esc(lineById[l].short)).join(' / ')} · ${s.lines.some(l=>lineById[l].status==='operational')?'Operating station':'Future station position'}</small></span></button>`).join('');
  if(!matchedLines.length&&!matchedStations.length)$('search-results').innerHTML='<div class="search-empty">No station found. Try a nearby locality or line.</div>';
  $('search-results').hidden=false;$('station-search').setAttribute('aria-expanded','true');
  $('search-results').querySelectorAll('[data-result-line]').forEach(b=>b.onclick=()=>{selectLine(b.dataset.resultLine);$('station-search').value='';closeSearch();});
  $('search-results').querySelectorAll('[data-result-station]').forEach(b=>b.onclick=()=>{const s=stationById[b.dataset.resultStation];const lid=s.lines.includes(state.selected)?state.selected:s.lines[0];selectLine(lid,false);openStation(s.id,lid);$('station-search').value='';closeSearch();});
}
function closeSearch(){ $('search-results').hidden=true;$('station-search').setAttribute('aria-expanded','false'); }
function prepareFeatures(){
  routes.forEach(route=>{
    const line=lineById[route.id];const base={lineId:line.id,name:line.name,color:line.color,status:line.status};
    if(line.id==='pink'){
      routeFeatures.push(lineFeature(route.coordinates.slice(0,109),{...base,section:'elevated',status:'scheduled'}));
      routeFeatures.push(lineFeature(route.coordinates.slice(108),{...base,section:'underground',status:'construction'}));
    }else if(line.id==='blue'){
      routeFeatures.push(lineFeature(route.coordinates.slice(0,207),{...base,section:'Phase 2A'}));routeFeatures.push(lineFeature(route.coordinates.slice(206),{...base,section:'Phase 2B'}));
    }else routeFeatures.push(lineFeature(route.coordinates,base));
    if(['orange','orange-west','red'].includes(line.id))for(const part of (route.parts||[]).slice(1))routeFeatures.push(lineFeature(part,{...base,section:'Mapped spur'}));
  });
  stations.forEach(st=>{
    const first=st.lines.find(l=>lineById[l].status==='operational')||st.lines[0];const line=lineById[first];
    const activeConnections=st.lines.filter(l=>lineById[l].status==='operational').length;
    stationFeatures.push(pointFeature(st.coordinates,{id:st.id,name:st.name,lineId:first,lines:st.lines.join(','),color:line.color,status:stationStatus(st,first),connection:st.lines.length>1,activeInterchange:activeConnections>1}));
    stationExtrusions.push(circlePolygon(st.coordinates,st.lines.length>1?43:29,{id:st.id,lineId:first,lines:st.lines.join(','),color:line.color,status:stationStatus(st,first),height:st.lines.length>1?80:42}));
  });
  routeFeatures.filter(f=>f.properties.status!=='proposed').forEach(f=>{
    const c=f.geometry.coordinates;
    for(let i=1;i<c.length;i++){
      const a=c[i-1],b=c[i];const dx=(b[0]-a[0])*Math.cos(a[1]*Math.PI/180),dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.000001)continue;
      const offset=0.000075,nx=-dy/len*offset/Math.cos(a[1]*Math.PI/180),ny=dx/len*offset;
      extrusionFeatures.push({type:'Feature',properties:{...f.properties,height:f.properties.section==='underground'?4:23},geometry:{type:'Polygon',coordinates:[[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny],[a[0]+nx,a[1]+ny]]]}});
    }
  });
}
function circlePolygon(c,r,properties){const ring=[];for(let i=0;i<=12;i++){const a=i/12*Math.PI*2;ring.push([c[0]+Math.cos(a)*r/(111320*Math.cos(c[1]*Math.PI/180)),c[1]+Math.sin(a)*r/111320]);}return{type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties};}
function createMap(){
  try{
    map=new maplibregl.Map({container:'map',style:'map-style.json',center:[77.597,12.986],zoom:11.65,pitch:48,bearing:-16,antialias:true,maxPitch:72,minZoom:9,maxZoom:18.6,attributionControl:false,renderWorldCopies:false,dragRotate:true,cooperativeGestures:false});
    map.addControl(new maplibregl.AttributionControl({compact:mobile(),customAttribution:'Metro geography © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}),'bottom-right');
    map.addControl(new maplibregl.ScaleControl({maxWidth:80,unit:'metric'}),'bottom-left');
    map.on('load',()=>{
      loaded=true;map.setLight({anchor:'viewport',color:'#d9ecc0',intensity:.38,position:[1,225,45]});
      const firstLabel=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
      map.addLayer({id:'city-buildings-3d',source:'openmaptiles','source-layer':'building',type:'fill-extrusion',minzoom:13.5,paint:{'fill-extrusion-color':'#3c5236','fill-extrusion-height':['interpolate',['linear'],['zoom'],13.5,0,14.5,['coalesce',['get','render_height'],8]],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.8}},firstLabel);
      map.addSource('metro-routes',{type:'geojson',data:featureCollection(routeFeatures)});
      map.addSource('metro-stations',{type:'geojson',data:featureCollection(stationFeatures)});
      map.addSource('metro-extrusions',{type:'geojson',data:featureCollection(extrusionFeatures)});
      map.addSource('station-extrusions',{type:'geojson',data:featureCollection(stationExtrusions)});
      map.addLayer({id:'route-halo',type:'line',source:'metro-routes',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,10,14,18],'line-opacity':.085,'line-blur':5}});
      map.addLayer({id:'route-casing',type:'line',source:'metro-routes',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0d1d13','line-width':['interpolate',['linear'],['zoom'],10,4.5,14,8],'line-opacity':.9}});
      map.addLayer({id:'route-operating',type:'line',source:'metro-routes',filter:['==',['get','status'],'operational'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,2.5,13,4,17,7]}});
      map.addLayer({id:'route-building',type:'line',source:'metro-routes',filter:['in',['get','status'],['literal',['construction','scheduled']]],layout:{'line-cap':'butt','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,2.3,13,3.5,17,6],'line-dasharray':[2.4,1.4]}});
      map.addLayer({id:'route-proposed',type:'line',source:'metro-routes',filter:['==',['get','status'],'proposed'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,2,13,3,17,5],'line-dasharray':[.7,1.8]}});
      map.addLayer({id:'metro-tracks-3d',type:'fill-extrusion',source:'metro-extrusions',minzoom:13.7,paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':.7}});
      map.addLayer({id:'metro-stations-3d',type:'fill-extrusion',source:'station-extrusions',minzoom:13.2,paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':.9}});
      map.addLayer({id:'station-dots',type:'circle',source:'metro-stations',paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,1.7,12,3,15,5.5],'circle-color':'#1c3021','circle-stroke-color':['get','color'],'circle-stroke-width':['interpolate',['linear'],['zoom'],10,1,14,2]}});
      map.addLayer({id:'interchange-dots',type:'circle',source:'metro-stations',filter:['==',['get','activeInterchange'],true],paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,3.3,13,5.5],'circle-color':'#e5edd7','circle-stroke-color':'#243c22','circle-stroke-width':1.5}});
      map.addLayer({id:'station-labels',type:'symbol',source:'metro-stations',minzoom:11.6,layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],11.6,9,15,12],'text-offset':[0,1.1],'text-anchor':'top','text-max-width':15,'text-optional':true,'text-padding':7,'symbol-sort-key':['case',['get','connection'],0,1]},paint:{'text-color':'#c7d6b2','text-halo-color':'#15291b','text-halo-width':1.8,'text-halo-blur':.5}});
      map.addLayer({id:'route-click-target',type:'line',source:'metro-routes',paint:{'line-width':20,'line-opacity':0}});
      map.addLayer({id:'station-click-target',type:'circle',source:'metro-stations',paint:{'circle-radius':11,'circle-opacity':0}});
      map.on('click',e=>{
        const pts=map.queryRenderedFeatures(e.point,{layers:['station-click-target','interchange-dots']});
        if(pts.length){const st=stationById[pts[0].properties.id];const id=st.lines.includes(state.selected)?state.selected:st.lines.find(l=>visibleLine(lineById[l]))||st.lines[0];openStation(st.id,id);return;}
        const hits=map.queryRenderedFeatures(e.point,{layers:['route-click-target']});if(hits.length)selectLine(hits[0].properties.lineId);
      });
      for(const id of ['route-click-target','station-click-target']){map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',id,()=>map.getCanvas().style.cursor='');}
      updateMap();$('loading-panel').style.opacity=0;setTimeout(()=>$('loading-panel').hidden=true,500);
      if(state.selected)fitLine(state.selected);else if(mobile())map.jumpTo({center:[77.591,12.985],zoom:10.98,pitch:39,bearing:-14,padding:{top:0,bottom:205,left:5,right:5}});
    });
    map.on('move',()=>{const c=map.getCenter();$('map-coordinate').innerHTML=c.lat.toFixed(2)+'° N &nbsp; '+c.lng.toFixed(2)+'° E';$('north-arrow').style.transform=`rotate(${-map.getBearing()}deg)`;});
    map.on('zoom',()=>{if(!state.selected)$('map-title').style.opacity=map.getZoom()>12.5?0:1;});
    map.on('pitch',()=>{const value=map.getPitch()>8; if(value!==state.is3d){state.is3d=value;syncViewButtons();update3d();}});
    map.on('error',e=>{console.warn('Map resource:',e.error?.message);if(e.error?.message?.includes('WebGL')){$('loading-panel').hidden=true;$('map-error').hidden=false;}});
    setTimeout(()=>{if(!loaded){$('loading-panel').hidden=true;$('map-error').hidden=false;}},30000);
  }catch(error){
    console.info('Using the geographic compatibility renderer:',error.message);
    map=new CanvasAtlas($('map'),{center:[77.597,12.986],zoom:mobile()?10.98:11.65,pitch:mobile()?39:48,bearing:-16},{onStation:openStation,onRoute:selectLine,onMove:()=>{const c=map.getCenter();$('map-coordinate').innerHTML=c.lat.toFixed(2)+'° N &nbsp; '+c.lng.toFixed(2)+'° E';$('north-arrow').style.transform=`rotate(${-map.getBearing()}deg)`;if(!state.selected)$('map-title').style.opacity=map.getZoom()>12.5?0:1;},onPitch:value=>{state.is3d=value;syncViewButtons();}});
    loaded=true;$('loading-panel').hidden=true;$('map-error').hidden=true;
    $('show-buildings').checked=false;$('show-buildings').disabled=true;state.buildings=false;
    $('layers-panel').querySelector('p').textContent='Compatibility view: geographic map with 3D station markers. Building extrusions require WebGL.';
    if(mobile())map.jumpTo({padding:{top:0,bottom:205,left:5,right:5}});
    updateMap();if(state.selected)fitLine(state.selected);
  }
}
function updateMap(){
  if(!loaded)return;
  if(map.isFallback){map.renderData({state:{...state},lines,stations,routeFeatures,stationFeatures});return;}
  const allowed=lines.filter(visibleLine).map(l=>l.id);const selected=state.selected;
  const filteredRoutes=routeFeatures.filter(f=>allowed.includes(f.properties.lineId));map.getSource('metro-routes').setData(featureCollection(filteredRoutes));
  const filteredStations=stationFeatures.filter(f=>f.properties.lines.split(',').some(l=>allowed.includes(l))).map(f=>{
    const st=stationById[f.properties.id];const lid=selected&&st.lines.includes(selected)?selected:st.lines.find(l=>allowed.includes(l))||st.lines[0];
    return {...f,properties:{...f.properties,lineId:lid,color:lineById[lid].color,status:stationStatus(st,lid)}};
  });
  map.getSource('metro-stations').setData(featureCollection(filteredStations));
  const opacity=(normal,faded)=>selected?['case',['==',['get','lineId'],selected],normal,faded]:normal;
  ['route-operating','route-building','route-proposed'].forEach(id=>map.setPaintProperty(id,'line-opacity',opacity(1,.14)));
  map.setPaintProperty('route-halo','line-opacity',opacity(.16,.015));map.setPaintProperty('route-casing','line-opacity',opacity(.9,.15));
  map.setPaintProperty('station-dots','circle-opacity',opacity(1,.15));map.setPaintProperty('station-dots','circle-stroke-opacity',opacity(1,.15));
  map.setPaintProperty('station-labels','text-opacity',opacity(1,.12));
  if(selected)map.setFilter('interchange-dots',['all',['==',['get','activeInterchange'],true],['in',selected,['get','lines']]]);else map.setFilter('interchange-dots',['==',['get','activeInterchange'],true]);
  map.getSource('metro-extrusions').setData(featureCollection(extrusionFeatures.filter(f=>allowed.includes(f.properties.lineId)&&(!selected||f.properties.lineId===selected))));
  const stationIds=new Set(filteredStations.filter(f=>!selected||stationById[f.properties.id].lines.includes(selected)).map(f=>f.properties.id));
  map.getSource('station-extrusions').setData(featureCollection(stationExtrusions.filter(f=>stationIds.has(f.properties.id)).map(f=>selected?{...f,properties:{...f.properties,color:lineById[selected].color}}:f)));
  map.setLayoutProperty('station-labels','visibility',state.labels?'visible':'none');update3d();
}
function update3d(){if(!loaded)return;if(map.isFallback){map.renderData({state:{...state},lines,stations,routeFeatures,stationFeatures});return;}map.setLayoutProperty('city-buildings-3d','visibility',state.is3d&&state.buildings?'visible':'none');for(const id of ['metro-tracks-3d','metro-stations-3d'])map.setLayoutProperty(id,'visibility',state.is3d?'visible':'none');}
function set3d(value){state.is3d=value;syncViewButtons();update3d();map?.easeTo({pitch:value?55:0,bearing:value?-16:0,duration:reducedMotion?0:900});}
function syncViewButtons(){for(const [id,val] of [['view-2d',false],['view-3d',true]]){$(id).classList.toggle('active',state.is3d===val);$(id).setAttribute('aria-pressed',String(state.is3d===val));}}
function fitLine(id){if(!loaded)return;const r=routes.find(r=>r.id===id);if(!r)return;const bounds=r.coordinates.reduce((b,c)=>b.extend(c),new maplibregl.LngLatBounds(r.coordinates[0],r.coordinates[0]));map.fitBounds(bounds,{padding:mobile()?{top:65,bottom:Math.max(285,window.innerHeight*.55),left:35,right:65}:{top:100,bottom:120,left:75,right:95},pitch:state.is3d?48:0,bearing:state.is3d?-12:0,maxZoom:13.3,duration:reducedMotion?0:1300});}
function fitNetwork(){if(!loaded)return;const visible=routes.filter(r=>visibleLine(lineById[r.id]));if(!visible.length)return;const coords=visible.flatMap(r=>r.coordinates);const b=coords.reduce((b,c)=>b.extend(c),new maplibregl.LngLatBounds(coords[0],coords[0]));map.fitBounds(b,{padding:mobile()?{top:75,bottom:300,left:35,right:65}:{top:90,bottom:110,left:55,right:85},pitch:state.is3d?35:0,bearing:state.is3d?-12:0,maxZoom:12,duration:reducedMotion?0:1200});toast('Entire visible network, including the airport corridor');}
function cityView(){map?.easeTo({center:[77.597,12.986],zoom:mobile()?10.98:11.65,pitch:state.is3d?(mobile()?39:48):0,bearing:state.is3d?-16:0,padding:mobile()?{top:0,bottom:205,left:5,right:5}:{top:0,bottom:0,left:0,right:0},duration:reducedMotion?0:1100});}
function openStation(id,preferredLine){
  if(!loaded){toast('The map is still loading. Station details will be available shortly.');return;}
  const st=stationById[id],lid=preferredLine||st.lines[0];if(!st)return;
  const line=lineById[lid];const status=stationStatus(st,lid);const src=lid==='pink'&&status==='scheduled'?'pink-pmo':line.sourceIds[0];
  if(!state.expansion&&line.status!=='operational'){state.expansion=true;$('show-expansion').checked=true;updateMap();}
  if(state.filter!=='all'&&state.filter!==line.status)setFilter('all',false);
  if(popup)popup.remove();
  const html=`<div class="station-popup"><div class="eyebrow">${status==='operational'?'OPERATING STATION':'FUTURE STATION POSITION'}</div><h3>${esc(st.name)}</h3>${st.nameKn?`<p lang="kn">${esc(st.nameKn)}</p>`:''}${st.altName&&st.altName!==st.name?`<p>Also mapped as ${esc(st.altName)}</p>`:''}${st.lines.map(l=>`<p><span class="station-line-pill"><span class="result-dot" style="--color:${lineById[l].color}"></span>${esc(lineById[l].short)}</span>${esc(statusText(stationStatus(st,l)))}</p>`).join('')}${st.lines.length>1?'<p>Connections depend on each platform’s service status.</p>':''}<p class="coordinate-text">${st.coordinates[1].toFixed(5)}° N · ${st.coordinates[0].toFixed(5)}° E</p><p>Station status follows corridor evidence.<br>No station-level completion estimate.</p>${sourceLink(src,'Official status evidence')}<br><button class="popup-link" id="popup-explore">Explore ${esc(line.name)} →</button></div>`;
  popup=map.isFallback?map.showPopup(st.coordinates,html):new maplibregl.Popup({offset:18,maxWidth:mobile()?'255px':'295px',closeOnClick:false,focusAfterOpen:false}).setLngLat(st.coordinates).setHTML(html).addTo(map);
  $('popup-explore').onclick=()=>{popup.remove();selectLine(lid);};
  if(mobile()){$('sidebar').classList.remove('expanded','detail-open');}
  const containerHeight=$('map').clientHeight;
  map.easeTo({center:st.coordinates,zoom:15.3,pitch:state.is3d?60:0,bearing:state.is3d?-23:0,padding:mobile()?{top:Math.max(20,containerHeight*.17),bottom:270,left:15,right:15}:{top:110,bottom:70,left:30,right:50},duration:reducedMotion?0:1500});
  $('map-title').style.opacity=0;$('pink-notice').hidden=true;
}
function showDialog(title,eyebrow,html){$('dialog-title').textContent=title;$('dialog-eyebrow').textContent=eyebrow;$('dialog-content').innerHTML=html;$('information-dialog').showModal();$('information-dialog').scrollTop=0;}
function showSources(lineId){
  const line=lineById[lineId]; const sources=line?evidence.sources.filter(s=>line.sourceIds.includes(s.id)):evidence.sources;
  showDialog(line?line.name+' · Evidence':'Sources & freshness','OFFICIAL EVIDENCE, CLEARLY DATED',`<p class="dialog-lead">An independent geographic atlas, researched on <b>13 November 2026 IST, before the scheduled inauguration</b>. Operating and project status come from the official sources below. Each fact retains its own publication or measurement date.</p><div class="source-banner"><b>A dated snapshot.</b> This site does not automatically poll government pages or provide live delays, train locations or service disruptions. A scheduled inauguration is not treated as confirmed passenger operation. Construction percentages are historical project-wide measurements.</div>${sources.map(s=>`<article class="source-card"><div class="source-kicker"><span>${esc(s.authority.toUpperCase())}</span><span>${esc(s.published)}</span></div><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Read original official source ↗</a></article>`).join('')}<div class="source-footnote"><h3>Geography & 3D</h3><p>Street geography and building footprints (WebGL view): <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> / © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. The compatibility view uses OpenStreetMap raster tiles with projected station geometry. Rendered with <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre GL JS</a>.</p><p>Operating track alignments and station positions: OSM data exported by <a href="https://github.com/Vonter/bmrcl-gtfs" target="_blank" rel="noopener noreferrer">Vonter/bmrcl-gtfs</a>. Expansion geometry: <a href="https://wiki.openstreetmap.org/wiki/Namma_Metro" target="_blank" rel="noopener noreferrer">OSM route relations</a>, retrieved 13 Nov 2026. Geography is community mapped, not an official engineering survey. Proposed Orange and Red paths may change. Blue’s OSM relation omits Bettahalasuru; mapped names are not an official station register.</p><p><b>3D track and station heights are illustrative.</b> Building heights use mapped values where available, with an 8 m fallback. Underground sections are projected onto the surface for legibility. Split points are visual approximations, not contract boundaries. Station status inherits corridor evidence; no station-level completion is inferred.</p><p>Geodata is available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Database License</a>. <a href="data/network.json" download="namma-atlas-osm-geography.json">Download the attributed geography</a> · <a href="data/status.json" download="namma-atlas-official-evidence.json">Download status & source register</a></p><p>Want to check for newer announcements? <a href="https://www.bmrc.co.in/news-letters/" target="_blank" rel="noopener noreferrer">BMRCL newsletters ↗</a> · <a href="https://www.bmrc.co.in/" target="_blank" rel="noopener noreferrer">BMRCL official website ↗</a></p></div>`);
}
function showStatus(){
  showDialog('The network, in progress','PROJECT STATUS · RESEARCHED 13 NOV 2026',`<p class="dialog-lead">Passenger service, inauguration and construction are separate milestones. Historical measurements below apply to the named <b>whole project</b>, not individual stations.</p><div class="status-table-wrap"><table class="status-table"><thead><tr><th>CORRIDOR</th><th>VERIFIED POSITION</th><th>EVIDENCE DATE</th><th>OFFICIAL SOURCE</th></tr></thead><tbody>${lines.map(l=>{const s=sourceById[l.sourceIds[0]];return `<tr><td><button class="table-select" data-status-line="${l.id}"><span class="table-line-name"><i class="table-line-dot" style="background:${l.color}"></i>${esc(l.name)} ↗</span><small>${esc(l.length)} km · ${esc(l.phase)}</small></button></td><td>${esc(l.statusLabel)}${l.progress?`<small>${l.progress.value.toFixed(2)}% · ${esc(l.progress.scope)}<br>Measured ${esc(l.progress.asOf)} · historical</small>`:''}${l.id==='pink'?'<small>Elevated: scheduled inauguration.<br>Underground: construction.<br>Public-service opening not verified.</small>':''}${l.id==='red'?'<small>Newer central sanction not verified.<br>Evidence is older.</small>':''}</td><td>${esc(s.published)}</td><td>${sourceLink(l.sourceIds[0])}</td></tr>`;}).join('')}</tbody></table></div><div class="source-footnote">BMRCL lists <b>96.10 km</b> in operation. The station total of <b>83</b> counts operating interchanges once. Planned corridor lengths and operating lengths use the cited official sources; GIS track lengths can differ.</div>`);
  $('dialog-content').querySelectorAll('[data-status-line]').forEach(b=>b.onclick=()=>{$('information-dialog').close();selectLine(b.dataset.statusLine);});
}
function showAbout(){showDialog('How to read the atlas','A GEOGRAPHIC VIEW',`<p class="dialog-lead">Every corridor has its own line colour. The stroke tells you its service status.</p><div class="source-card"><h3>Solid · Operating</h3><p>The corridor is listed in passenger operation by BMRCL. This does not indicate that trains are running at this precise moment or that there are no disruptions.</p></div><div class="source-card"><h3>Dashed · Building or scheduled for inauguration</h3><p>A construction or pre-opening corridor. Pink’s elevated section is scheduled for inauguration; the status panel distinguishes it from the underground construction section.</p></div><div class="source-card"><h3>Dotted · Proposed</h3><p>A future corridor with older proposal evidence. Alignment and station names are indicative and can change.</p></div><div class="source-card"><h3>Bright interchange dots · Operating connections</h3><p>Large pale dots mark operating line connections. Future platforms can share a station location; click a station to check each line separately.</p></div><div class="source-footnote">Drag to pan, scroll or pinch to zoom, and right-drag or use two fingers to tilt and rotate. Switch between 2D and 3D at any time. Click a corridor to isolate it; search a station to fly into its neighbourhood. 3D track and station heights are illustrative.</div>`);}
init();
