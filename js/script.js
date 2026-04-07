'use strict';

/* ══════════════════════════════════════════
   THEME SYSTEM
   ══════════════════════════════════════════ */
const THEME_LINK      = document.getElementById('theme-style');
const THEME_GRID      = document.getElementById('themeGrid');
const DEFAULT_THEME   = 'ocean-teal';
const THEME_STORE_KEY = 'ipinfo-color-theme';
const THEME_CSS_PFX   = 'ipinfo-theme-css-';

function injectThemeCSS(cssText){
  let el = document.getElementById('theme-inline');
  if(!el){ el = document.createElement('style'); el.id = 'theme-inline'; document.head.appendChild(el); }
  el.textContent = cssText;
  THEME_LINK.disabled = true;
}

function applyColorTheme(id, save=true){
  const theme = THEMES.find(t=>t.id===id) || THEMES.find(t=>t.id===DEFAULT_THEME);
  if(!theme) return;

  const cacheKey = THEME_CSS_PFX + theme.id;
  const cached   = sessionStorage.getItem(cacheKey);
  if(cached){
    injectThemeCSS(cached);
  } else {
    const el = document.getElementById('theme-inline');
    if(el) el.textContent = '';
    THEME_LINK.disabled = false;
    THEME_LINK.href = 'css/themes/' + theme.file;
    fetch('css/themes/' + theme.file)
      .then(r=>r.text())
      .then(css=>{ try{ sessionStorage.setItem(cacheKey,css); }catch(e){} })
      .catch(()=>{});
  }

  document.querySelectorAll('.theme-card').forEach(c=>{
    c.classList.toggle('active', c.dataset.id===theme.id);
  });

  /* FIX 4: Re-style map layer colors WITHOUT re-centering (use setStyle not renderMap) */
  if(typeof geoLayer!=='undefined' && geoLayer && mapInstance){
    const uc = E.country.textContent.replace(/\s*\(.*\)/,'').trim().toLowerCase();
    // CSS vars may not have updated yet — read after a micro-task
    requestAnimationFrame(()=>{
      const primary  = getComputedStyle(document.body).getPropertyValue('--p').trim();
      const pcColor  = getComputedStyle(document.body).getPropertyValue('--pc').trim();
      geoLayer.setStyle(f=>{
        const m = (f.properties.name||'').toLowerCase()===uc;
        return{
          color:       m ? (isDark?pcColor:primary) : (isDark?'#444':'#8fa8b8'),
          weight:      m ? 2 : 1.2,
          fillColor:   m ? primary : (isDark?'#222':'#1a1f23'),
          fillOpacity: m ? 0.45 : (isDark?0.2:0.18)
        };
      });
    });
  }

  if(save) localStorage.setItem(THEME_STORE_KEY, theme.id);
}

function buildThemeGrid(){
  THEME_GRID.innerHTML = '';
  THEMES.forEach(t=>{
    const card = document.createElement('div');
    card.className   = 'theme-card';
    card.dataset.id  = t.id;

    const swatches = document.createElement('div');
    swatches.className = 'theme-swatches';
    t.colors.forEach(c=>{
      const s = document.createElement('span');
      s.className = 'theme-swatch';
      s.style.background = c;
      swatches.appendChild(s);
    });

    const name = document.createElement('span');
    name.className   = 'theme-name';
    name.textContent = t.name;

    card.appendChild(swatches);
    card.appendChild(name);
    card.addEventListener('click', ()=>applyColorTheme(t.id));
    THEME_GRID.appendChild(card);
  });
}

function initTheme(){
  buildThemeGrid();
  const saved = localStorage.getItem(THEME_STORE_KEY) || DEFAULT_THEME;
  applyColorTheme(saved, false);
  document.querySelectorAll('.theme-card').forEach(c=>{
    c.classList.toggle('active', c.dataset.id===saved);
  });
}

/* ══════════════════════════════════════════
   APP STATE
   ══════════════════════════════════════════ */
const COOLDOWN_MS = 5000;
const MIN_ZOOM = 1, MAX_ZOOM = 8;

let currentLat = NaN, currentLon = NaN;
let mapInstance = null, geoLayer = null, cityMarker = null;
let cachedGeo   = null;
let toastTimer  = null;
let isLoading   = false;
let cooldownTimer = null, cooldownInterval = null;
let currentMapZoom = 3;
let isFullscreen   = false;

const $ = id => document.getElementById(id);
const E = {
  country:$('country'), latlng:$('latlng'),
  city:$('city'), isp:$('isp'), tz:$('tz'),
  ipv4:$('ipv4'), ipv6:$('ipv6'),
  mapBtn:$('mapBtn'), mapBox:$('mapBox'),
  inp:$('inp'), clearBtn:$('clearBtn'),
  rBox:$('rBox'), rIP:$('rIP'),
  cRes:$('cRes'), cc:$('cc'), cl:$('cl'), cct:$('cct'), ci:$('ci'),
  toast:$('toast'), themeBtn:$('themeBtn'), reloadBtn:$('reloadBtn'),
  bar:$('cooldownBar'), mapLabel:$('mapLabel'),
  zoomNum:$('zoomNum'), zoomIn:$('zoomIn'), zoomOut:$('zoomOut'),
  fsBtn:$('fsBtn'), mapTime:$('mapTime'),
  toastIcon:$('toastIcon'), toastMsg:$('toastMsg')
};

/* ── Skeleton helpers ── */
const SKEL_CLASSES = {
  latlng:'skel skel-latlng', city:'skel skel-city',
  isp:'skel skel-isp',       tz:'skel skel-tz',
  ipv4:'skel skel-ipv4',     ipv6:'skel skel-ipv6',
};
function showSkeletons(){
  for(const [key,cls] of Object.entries(SKEL_CLASSES))
    E[key].innerHTML = `<span class="${cls}"></span>`;
}
function clearSkel(el, html, isHTML=false){
  if(isHTML) el.innerHTML = html; else el.textContent = html;
}

/* ── Toast (FIX 3: circle around icon, same color) ── */
// ok=true → ✓ green circle, ok=false → ✕ red circle, ok=null → no icon
function toast(msg, ok=null, dur=2400){
  clearTimeout(toastTimer);
  E.toastMsg.textContent = msg;
  if(ok===true){
    E.toastIcon.textContent = '✓';
    E.toastIcon.className   = 'toast-icon ok';
  } else if(ok===false){
    E.toastIcon.textContent = '✕';
    E.toastIcon.className   = 'toast-icon fail';
  } else {
    E.toastIcon.textContent = '';
    E.toastIcon.className   = 'toast-icon none';
  }
  E.toast.classList.add('show');
  toastTimer = setTimeout(()=>E.toast.classList.remove('show'), dur);
}

/* ── Copy (delegated) ── */
document.addEventListener('click', e=>{
  if(!e.target.classList.contains('info-value')) return;
  const t = e.target.textContent.trim();
  if(!t || t==='—') return;
  navigator.clipboard.writeText(t)
    .then(()=>toast('Copied: '+t, true))
    .catch(()=>toast('Copy failed', false));
});

/* ── Dark / Light mode toggle ── */
let isDark = localStorage.getItem('theme')==='dark';
function applyDarkMode(){
  document.body.classList.toggle('dark', isDark);
  E.themeBtn.textContent = isDark ? 'Light' : 'Dark';
  /* FIX 4: use setStyle, not renderMap */
  if(geoLayer && mapInstance){
    const uc = E.country.textContent.replace(/\s*\(.*\)/,'').trim().toLowerCase();
    requestAnimationFrame(()=>{
      const primary = getComputedStyle(document.body).getPropertyValue('--p').trim();
      const pcColor = getComputedStyle(document.body).getPropertyValue('--pc').trim();
      geoLayer.setStyle(f=>{
        const m=(f.properties.name||'').toLowerCase()===uc;
        return{
          color:       m?(isDark?pcColor:primary):(isDark?'#444':'#8fa8b8'),
          weight:      m?2:1.2,
          fillColor:   m?primary:(isDark?'#222':'#1a1f23'),
          fillOpacity: m?0.45:(isDark?0.2:0.18)
        };
      });
    });
  }
}
applyDarkMode();
E.themeBtn.addEventListener('click', ()=>{
  isDark = !isDark;
  localStorage.setItem('theme', isDark?'dark':'light');
  applyDarkMode();
});

/* ── Section toggle ── */
function toggleSection(id, btn){
  const open = $(id).classList.toggle('show');
  btn.classList.toggle('open', open);
}

/* ── Fetch with timeout ── */
async function fetchJSON(url, ms=8000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), ms);
  try{
    const r = await fetch(url, {signal:ctrl.signal});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }finally{ clearTimeout(t); }
}

/* ── Reload lock + cooldown bar ── */
function lockReload(){
  isLoading = true;
  E.reloadBtn.disabled = true;
  E.reloadBtn.textContent = 'Loading...';
}
function startCooldown(){
  E.bar.style.transition = 'none';
  E.bar.style.width = '100%';
  E.bar.style.display = 'block';
  void E.bar.offsetWidth;
  let remaining = COOLDOWN_MS;
  const tick = 200;
  clearInterval(cooldownInterval);
  clearTimeout(cooldownTimer);
  cooldownInterval = setInterval(()=>{
    remaining -= tick;
    const pct = Math.max(0,(remaining/COOLDOWN_MS)*100);
    E.bar.style.transition = `width ${tick}ms linear`;
    E.bar.style.width = pct+'%';
    const secs = Math.ceil(remaining/1000);
    E.reloadBtn.textContent = secs>0 ? `Wait ${secs}s` : 'Wait...';
  }, tick);
  cooldownTimer = setTimeout(()=>{
    clearInterval(cooldownInterval);
    E.bar.style.width = '0%';
    setTimeout(()=>{ E.bar.style.display='none'; }, 200);
    isLoading = false;
    E.reloadBtn.disabled = false;
    E.reloadBtn.textContent = 'Reload';
  }, COOLDOWN_MS);
}

/* ── UTC offset ── */
function getUTCOffset(tzId){
  if(!tzId) return '';
  try{
    const parts = new Intl.DateTimeFormat('en',{timeZone:tzId,timeZoneName:'shortOffset'}).formatToParts(new Date());
    return (parts.find(p=>p.type==='timeZoneName')?.value||'').replace('GMT','UTC');
  }catch(e){ return ''; }
}

/* ── Live clock (timezone row) ── */
let liveClockTimer = null;
let currentTZ = '';
let clockRunning = false;

function getLiveTime(tzId){
  try{
    return new Intl.DateTimeFormat('en',{timeZone:tzId,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date());
  }catch(e){ return ''; }
}
function startLiveClock(){
  const badge = document.getElementById('utcBadge');
  if(!badge||!currentTZ) return;
  clockRunning = true;
  function tick(){ const t=getLiveTime(currentTZ); if(badge) badge.textContent=t; }
  tick();
  liveClockTimer = setInterval(tick, 1000);
  badge.title = 'Tap to show UTC offset';
}
function stopLiveClock(){
  clearInterval(liveClockTimer);
  liveClockTimer = null;
  clockRunning = false;
  const badge = document.getElementById('utcBadge');
  if(badge&&currentTZ){ badge.textContent=getUTCOffset(currentTZ); badge.title='Tap to show live time'; }
}
function toggleClock(){ if(clockRunning) stopLiveClock(); else startLiveClock(); }

/* ── Populate ── */
function populate(d){
  E.country.textContent = [d.country, d.countryCode?`(${d.countryCode})`:''].filter(Boolean).join(' ') || '—';
  const lat = parseFloat(d.lat), lon = parseFloat(d.lon);
  if(!isNaN(lat)){
    currentLat = lat; currentLon = lon;
    clearSkel(E.latlng, `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  } else clearSkel(E.latlng, '—');
  clearSkel(E.city, [d.city,d.regionName].filter(Boolean).join(', ') || '—');
  clearSkel(E.isp, d.isp || '—');

  const tz = d.timezone || '';
  currentTZ = tz;
  stopLiveClock();
  const utc = getUTCOffset(tz);
  if(tz){
    clearSkel(E.tz,
      `${tz}${utc?` <span class="utc-badge" id="utcBadge" title="Tap to show live time" style="cursor:pointer">${utc}</span>`:''}`,
      true
    );
    const badge = document.getElementById('utcBadge');
    if(badge) badge.addEventListener('click', toggleClock);
  } else clearSkel(E.tz, '—');
}

/* ── GEO SOURCES (all HTTPS, all free, no key) ── */
async function geoFromIpWhoIs(){
  const d = await fetchJSON('https://ipwho.is/');
  if(!d.success) throw new Error('ipwho.is: '+d.message);
  return{country:d.country,countryCode:d.country_code,lat:d.latitude,lon:d.longitude,
         city:d.city,regionName:d.region,isp:d.connection?.isp||d.connection?.org||'',timezone:d.timezone?.id||''};
}
async function geoFromFreeIpApi(){
  const d = await fetchJSON('https://freeipapi.com/api/json');
  if(!d.ipAddress) throw new Error('freeipapi error');
  return{country:d.countryName,countryCode:d.countryCode,lat:d.latitude,lon:d.longitude,
         city:d.cityName,regionName:d.regionName,isp:d.isp||'',timezone:d.timeZone||''};
}
async function geoFromIpApiCo(){
  const d = await fetchJSON('https://ipapi.co/json/');
  if(d.error) throw new Error('ipapi.co: '+d.reason);
  return{country:d.country_name,countryCode:d.country_code,lat:d.latitude,lon:d.longitude,
         city:d.city,regionName:d.region,isp:d.org||'',timezone:d.timezone||''};
}

/* ── Load my IP ── */
async function loadMyIP(){
  if(isLoading){ toast('Please wait...', null); return; }
  lockReload();
  E.country.innerHTML = '<span class="spinner"></span>Loading...';
  showSkeletons();

  const [v4,v6] = await Promise.allSettled([
    fetchJSON('https://api.ipify.org?format=json'),
    fetchJSON('https://api64.ipify.org?format=json')
  ]);
  if(v4.status==='fulfilled' && v4.value?.ip) clearSkel(E.ipv4, v4.value.ip);
  else clearSkel(E.ipv4, 'Unavailable');
  if(v6.status==='fulfilled' && v6.value?.ip){
    const ip = v6.value.ip;
    if(ip.includes(':')) clearSkel(E.ipv6, ip);
    else{ clearSkel(E.ipv6,'Unavailable'); if(E.ipv4.textContent==='—') clearSkel(E.ipv4,ip); }
  } else clearSkel(E.ipv6, 'Unavailable');

  let geo = null;
  for(const src of [geoFromIpWhoIs, geoFromFreeIpApi, geoFromIpApiCo]){
    try{ geo = await src(); break; }
    catch(e){ console.warn(src.name, e.message); }
  }
  if(geo) populate(geo);
  else{
    E.country.textContent = 'Location unavailable';
    ['latlng','city','isp','tz'].forEach(k=>clearSkel(E[k],'—'));
    toast('All geo sources failed — check your connection', false);
  }
  startCooldown();
}

/* ── Custom IP / Domain lookup (FIX 1) ── */
async function lookupCustom(){
  const raw = E.inp.value.trim();
  if(!raw){ toast('Enter an IP or domain', null); return; }
  E.rBox.style.display = 'none';
  E.cRes.style.display = 'none';
  E.rIP.innerHTML = '';

  const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Re = /^[0-9a-fA-F:]+$/;
  const isDomain = !ipv4Re.test(raw) && !ipv6Re.test(raw);
  let ipToQuery = raw;

  if(isDomain){
    try{
      const [r4,r6] = await Promise.all([
        fetchJSON(`https://dns.google/resolve?name=${encodeURIComponent(raw)}&type=A`),
        fetchJSON(`https://dns.google/resolve?name=${encodeURIComponent(raw)}&type=AAAA`)
      ]);
      const v4s = (r4.Answer||[]).filter(x=>x.type===1).map(x=>x.data);
      const v6s = (r6.Answer||[]).filter(x=>x.type===28).map(x=>x.data);
      const all = [...new Set([...v4s,...v6s])];
      if(!all.length){ toast('Could not resolve domain', false); return; }

      E.rBox.style.display = 'block';
      all.forEach(ip=>{
        const chip = document.createElement('span');
        chip.className = 'chip '+(ipv4Re.test(ip)?'ipv4':'ipv6');
        chip.textContent = ip; chip.title = 'Click to lookup';
        chip.addEventListener('click', ()=>{ E.inp.value=ip; E.clearBtn.classList.add('show'); lookupCustom(); });
        E.rIP.appendChild(chip);
      });
      // FIX 1: prefer IPv4 for lookup since most geo APIs handle it better
      ipToQuery = v4s[0] || v6s[0];
    }catch(e){ toast('DNS resolution failed', false); console.error(e); return; }
  }

  /* FIX 1: try 3 APIs in sequence so lookup never silently fails */
  let found = false;
  // Source 1: ipwho.is
  try{
    const d = await fetchJSON(`https://ipwho.is/${encodeURIComponent(ipToQuery)}`);
    if(d.success && d.country){
      E.cRes.style.display = 'block';
      E.cc.textContent  = [d.country, d.country_code?`(${d.country_code})`:''].filter(Boolean).join(' ')||'—';
      E.cct.textContent = [d.city, d.region].filter(Boolean).join(', ')||'—';
      E.cl.textContent  = (d.latitude&&d.longitude) ? `${parseFloat(d.latitude).toFixed(4)}, ${parseFloat(d.longitude).toFixed(4)}` : '—';
      E.ci.textContent  = d.connection?.isp||d.connection?.org||'—';
      found = true;
    }
  }catch(e){ console.warn('ipwho.is custom:', e.message); }

  // Source 2: ipapi.co (fallback)
  if(!found){
    try{
      const d = await fetchJSON(`https://ipapi.co/${encodeURIComponent(ipToQuery)}/json/`);
      if(!d.error && d.country_name){
        E.cRes.style.display = 'block';
        E.cc.textContent  = [d.country_name, d.country_code?`(${d.country_code})`:''].filter(Boolean).join(' ')||'—';
        E.cct.textContent = [d.city, d.region].filter(Boolean).join(', ')||'—';
        E.cl.textContent  = (d.latitude&&d.longitude) ? `${parseFloat(d.latitude).toFixed(4)}, ${parseFloat(d.longitude).toFixed(4)}` : '—';
        E.ci.textContent  = d.org||'—';
        found = true;
      }
    }catch(e){ console.warn('ipapi.co custom:', e.message); }
  }

  // Source 3: freeipapi.com (fallback)
  if(!found){
    try{
      const d = await fetchJSON(`https://freeipapi.com/api/json/${encodeURIComponent(ipToQuery)}`);
      if(d.ipAddress && d.countryName){
        E.cRes.style.display = 'block';
        E.cc.textContent  = [d.countryName, d.countryCode?`(${d.countryCode})`:''].filter(Boolean).join(' ')||'—';
        E.cct.textContent = [d.cityName, d.regionName].filter(Boolean).join(', ')||'—';
        E.cl.textContent  = (d.latitude&&d.longitude) ? `${parseFloat(d.latitude).toFixed(4)}, ${parseFloat(d.longitude).toFixed(4)}` : '—';
        E.ci.textContent  = d.isp||'—';
        found = true;
      }
    }catch(e){ console.warn('freeipapi custom:', e.message); }
  }

  if(!found) toast('Geo lookup failed for this IP', false);
}

/* ── Input clear ── */
E.inp.addEventListener('input', ()=>E.clearBtn.classList.toggle('show', E.inp.value.length>0));
E.inp.addEventListener('keydown', e=>{ if(e.key==='Enter') lookupCustom(); });
E.clearBtn.addEventListener('click', ()=>{
  E.inp.value = '';
  E.clearBtn.classList.remove('show');
  E.rBox.style.display = 'none';
  E.cRes.style.display = 'none';
  E.rIP.innerHTML = '';
  E.inp.focus();
});

/* ══════════════════════════════
   MAP CLOCK
   ══════════════════════════════ */
const COUNTRY_TZ = {
  'Afghanistan':'Asia/Kabul','Albania':'Europe/Tirane','Algeria':'Africa/Algiers',
  'Angola':'Africa/Luanda','Argentina':'America/Argentina/Buenos_Aires',
  'Armenia':'Asia/Yerevan','Australia':'Australia/Sydney','Austria':'Europe/Vienna',
  'Azerbaijan':'Asia/Baku','Bahrain':'Asia/Bahrain','Bangladesh':'Asia/Dhaka',
  'Belarus':'Europe/Minsk','Belgium':'Europe/Brussels','Belize':'America/Belize',
  'Benin':'Africa/Porto-Novo','Bhutan':'Asia/Thimphu','Bolivia':'America/La_Paz',
  'Bosnia and Herz.':'Europe/Sarajevo','Botswana':'Africa/Gaborone',
  'Brazil':'America/Sao_Paulo','Brunei':'Asia/Brunei','Bulgaria':'Europe/Sofia',
  'Burkina Faso':'Africa/Ouagadougou','Burundi':'Africa/Bujumbura',
  'Cambodia':'Asia/Phnom_Penh','Cameroon':'Africa/Douala','Canada':'America/Toronto',
  'Central African Rep.':'Africa/Bangui','Chad':'Africa/Ndjamena','Chile':'America/Santiago',
  'China':'Asia/Shanghai','Colombia':'America/Bogota','Congo':'Africa/Brazzaville',
  'Dem. Rep. Congo':'Africa/Kinshasa','Costa Rica':'America/Costa_Rica',
  'Croatia':'Europe/Zagreb','Cuba':'America/Havana','Cyprus':'Asia/Nicosia',
  'Czech Rep.':'Europe/Prague','Denmark':'Europe/Copenhagen','Djibouti':'Africa/Djibouti',
  'Dominican Rep.':'America/Santo_Domingo','Ecuador':'America/Guayaquil',
  'Egypt':'Africa/Cairo','El Salvador':'America/El_Salvador',
  'Equatorial Guinea':'Africa/Malabo','Eritrea':'Africa/Asmara','Estonia':'Europe/Tallinn',
  'Ethiopia':'Africa/Addis_Ababa','Fiji':'Pacific/Fiji','Finland':'Europe/Helsinki',
  'France':'Europe/Paris','Gabon':'Africa/Libreville','Gambia':'Africa/Banjul',
  'Georgia':'Asia/Tbilisi','Germany':'Europe/Berlin','Ghana':'Africa/Accra',
  'Greece':'Europe/Athens','Guatemala':'America/Guatemala','Guinea':'Africa/Conakry',
  'Guinea-Bissau':'Africa/Bissau','Guyana':'America/Guyana','Haiti':'America/Port-au-Prince',
  'Honduras':'America/Tegucigalpa','Hungary':'Europe/Budapest','Iceland':'Atlantic/Reykjavik',
  'India':'Asia/Kolkata','Indonesia':'Asia/Jakarta','Iran':'Asia/Tehran','Iraq':'Asia/Baghdad',
  'Ireland':'Europe/Dublin','Israel':'Asia/Jerusalem','Italy':'Europe/Rome',
  'Ivory Coast':'Africa/Abidjan','Jamaica':'America/Jamaica','Japan':'Asia/Tokyo',
  'Jordan':'Asia/Amman','Kazakhstan':'Asia/Almaty','Kenya':'Africa/Nairobi',
  'Kosovo':'Europe/Belgrade','Kuwait':'Asia/Kuwait','Kyrgyzstan':'Asia/Bishkek',
  'Laos':'Asia/Vientiane','Latvia':'Europe/Riga','Lebanon':'Asia/Beirut',
  'Lesotho':'Africa/Maseru','Liberia':'Africa/Monrovia','Libya':'Africa/Tripoli',
  'Lithuania':'Europe/Vilnius','Luxembourg':'Europe/Luxembourg',
  'Macedonia':'Europe/Skopje','Madagascar':'Indian/Antananarivo','Malawi':'Africa/Blantyre',
  'Malaysia':'Asia/Kuala_Lumpur','Mali':'Africa/Bamako','Malta':'Europe/Malta',
  'Mauritania':'Africa/Nouakchott','Mauritius':'Indian/Mauritius','Mexico':'America/Mexico_City',
  'Moldova':'Europe/Chisinau','Mongolia':'Asia/Ulaanbaatar','Montenegro':'Europe/Podgorica',
  'Morocco':'Africa/Casablanca','Mozambique':'Africa/Maputo','Myanmar':'Asia/Rangoon',
  'Namibia':'Africa/Windhoek','Nepal':'Asia/Kathmandu','Netherlands':'Europe/Amsterdam',
  'New Zealand':'Pacific/Auckland','Nicaragua':'America/Managua','Niger':'Africa/Niamey',
  'Nigeria':'Africa/Lagos','North Korea':'Asia/Pyongyang','Norway':'Europe/Oslo',
  'Oman':'Asia/Muscat','Pakistan':'Asia/Karachi','Palestine':'Asia/Gaza',
  'Panama':'America/Panama','Papua New Guinea':'Pacific/Port_Moresby','Paraguay':'America/Asuncion',
  'Peru':'America/Lima','Philippines':'Asia/Manila','Poland':'Europe/Warsaw',
  'Portugal':'Europe/Lisbon','Puerto Rico':'America/Puerto_Rico','Qatar':'Asia/Qatar',
  'Romania':'Europe/Bucharest','Russia':'Europe/Moscow','Rwanda':'Africa/Kigali',
  'Saudi Arabia':'Asia/Riyadh','Senegal':'Africa/Dakar','Serbia':'Europe/Belgrade',
  'Sierra Leone':'Africa/Freetown','Slovakia':'Europe/Bratislava','Slovenia':'Europe/Ljubljana',
  'Somalia':'Africa/Mogadishu','South Africa':'Africa/Johannesburg',
  'South Korea':'Asia/Seoul','South Sudan':'Africa/Juba','Spain':'Europe/Madrid',
  'Sri Lanka':'Asia/Colombo','Sudan':'Africa/Khartoum','Suriname':'America/Paramaribo',
  'Swaziland':'Africa/Mbabane','Sweden':'Europe/Stockholm','Switzerland':'Europe/Zurich',
  'Syria':'Asia/Damascus','Taiwan':'Asia/Taipei','Tajikistan':'Asia/Dushanbe',
  'Tanzania':'Africa/Dar_es_Salaam','Thailand':'Asia/Bangkok','Timor-Leste':'Asia/Dili',
  'Togo':'Africa/Lome','Trinidad and Tobago':'America/Port_of_Spain','Tunisia':'Africa/Tunis',
  'Turkey':'Europe/Istanbul','Turkmenistan':'Asia/Ashgabat','Uganda':'Africa/Kampala',
  'Ukraine':'Europe/Kiev','United Arab Emirates':'Asia/Dubai',
  'United Kingdom':'Europe/London','United States of America':'America/New_York',
  'Uruguay':'America/Montevideo','Uzbekistan':'Asia/Tashkent','Venezuela':'America/Caracas',
  'Vietnam':'Asia/Ho_Chi_Minh','Yemen':'Asia/Aden','Zambia':'Africa/Lusaka',
  'Zimbabwe':'Africa/Harare'
};

let mapClockTimer = null;
let mapClockTZ = '';
let mapTimeMode = 'live';

function getMapTime(tzId){
  try{ return new Intl.DateTimeFormat('en',{timeZone:tzId,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date()); }
  catch(e){ return ''; }
}
function getMapUTC(tzId){
  if(!tzId) return '';
  try{
    const parts = new Intl.DateTimeFormat('en',{timeZone:tzId,timeZoneName:'shortOffset'}).formatToParts(new Date());
    return (parts.find(p=>p.type==='timeZoneName')?.value||'').replace('GMT','UTC');
  }catch(e){ return ''; }
}
function renderMapTime(){
  if(!mapClockTZ){ E.mapTime.textContent=''; return; }
  E.mapTime.textContent = mapTimeMode==='live' ? getMapTime(mapClockTZ) : getMapUTC(mapClockTZ);
}
function setMapClock(tzId){
  clearInterval(mapClockTimer);
  if(!tzId){ E.mapTime.textContent=''; return; }
  mapClockTZ = tzId;
  renderMapTime();
  mapClockTimer = setInterval(renderMapTime, 1000);
}
E.mapTime.addEventListener('click', ()=>{ mapTimeMode = mapTimeMode==='live' ? 'utc' : 'live'; renderMapTime(); });

/* ══════════════════════════════
   MAP
   ══════════════════════════════ */
async function loadTopoJSON(){
  if(window.topojson) return;
  await new Promise((res,rej)=>{
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/topojson-client@3/dist/topojson-client.min.js';
    s.onload = res; s.onerror = rej;
    document.body.appendChild(s);
  });
}
async function loadWorldGeo(){
  if(cachedGeo) return cachedGeo;
  const GEO_KEY = 'ipinfo-worldgeo-v1';
  try{
    const stored = sessionStorage.getItem(GEO_KEY);
    if(stored){ cachedGeo = JSON.parse(stored); return cachedGeo; }
  }catch(e){}
  const d = await fetchJSON('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
  cachedGeo = topojson.feature(d, d.objects.countries);
  try{ sessionStorage.setItem(GEO_KEY, JSON.stringify(cachedGeo)); }catch(e){}
  return cachedGeo;
}

function updateZoomUI(z){
  currentMapZoom = z;
  E.zoomNum.textContent = z;
  E.zoomOut.disabled = (z<=MIN_ZOOM);
  E.zoomIn.disabled  = (z>=MAX_ZOOM);
}
function applyZoom(z){
  z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  updateZoomUI(z);
  if(mapInstance){
    if(!isNaN(currentLat)) mapInstance.setView([currentLat,currentLon], z, {animate:true});
    else mapInstance.setZoom(z, {animate:true});
  }
}
E.zoomIn.addEventListener('click',  ()=>applyZoom(currentMapZoom+1));
E.zoomOut.addEventListener('click', ()=>applyZoom(currentMapZoom-1));

/* mapLabel button — reset to zoom 3 centered on country */
function resetMapToCountry(){
  if(!mapInstance||!cachedGeo) return;
  const uc = E.country.textContent.replace(/\s*\(.*\)/,'').trim().toLowerCase();
  for(const f of cachedGeo.features){
    if((f.properties.name||'').toLowerCase()===uc){
      const c = L.geoJSON(f).getBounds().getCenter();
      updateZoomUI(3);
      mapInstance.setView(c, 3, {animate:true});
      return;
    }
  }
  if(!isNaN(currentLat)) mapInstance.setView([currentLat,currentLon], 3, {animate:true});
}
E.mapLabel.addEventListener('click', resetMapToCountry);

/* FIX 2: Fullscreen — toolbar always visible, never behind browser chrome */
function toggleFullscreen(){
  isFullscreen = !isFullscreen;
  E.mapBox.classList.toggle('fullscreen', isFullscreen);
  E.fsBtn.innerHTML = isFullscreen ? '&#x2715;' : '&#x26F6;';
  E.fsBtn.title = isFullscreen ? 'Exit full screen' : 'Full screen';

  if(mapInstance){
    if(isFullscreen){
      mapInstance.dragging.enable();
      mapInstance.scrollWheelZoom.enable();
      mapInstance.touchZoom.enable();
      mapInstance.doubleClickZoom.enable();
    } else {
      mapInstance.dragging.disable();
      mapInstance.scrollWheelZoom.disable();
      mapInstance.touchZoom.disable();
      mapInstance.doubleClickZoom.disable();
    }
    setTimeout(()=>{
      mapInstance.invalidateSize();
      if(cachedGeo && !isFullscreen){
        const uc = E.country.textContent.replace(/\s*\(.*\)/,'').trim().toLowerCase();
        let found = false;
        for(const f of cachedGeo.features){
          if((f.properties.name||'').toLowerCase()===uc){
            const c = L.geoJSON(f).getBounds().getCenter();
            mapInstance.setView(c, currentMapZoom, {animate:false});
            found = true; break;
          }
        }
        if(!found && !isNaN(currentLat))
          mapInstance.setView([currentLat,currentLon], currentMapZoom, {animate:false});
      }
    }, 80);
  }
}
E.fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('keydown', e=>{ if(e.key==='Escape'&&isFullscreen) toggleFullscreen(); });

/* ── Floating country tooltip in fullscreen (FIX 5) ── */
let fsTooltip = null;
function showFsTip(latlng, name){
  if(fsTooltip){ fsTooltip.remove(); fsTooltip=null; }
  fsTooltip = L.tooltip({
    permanent: false,
    direction: 'top',
    className: 'map-click-tip',
    offset: [0, -4]
  })
  .setLatLng(latlng)
  .setContent(name)
  .addTo(mapInstance);
  setTimeout(()=>{ if(fsTooltip){ fsTooltip.remove(); fsTooltip=null; } }, 2000);
}

function renderMap(geo){
  if(!mapInstance) return;
  if(geoLayer)  { geoLayer.remove();   geoLayer   = null; }
  if(cityMarker){ cityMarker.remove(); cityMarker = null; }
  if(fsTooltip) { fsTooltip.remove();  fsTooltip  = null; }

  const primary = getComputedStyle(document.body).getPropertyValue('--p').trim();
  const pcColor = getComputedStyle(document.body).getPropertyValue('--pc').trim();
  const uc = E.country.textContent.replace(/\s*\(.*\)/,'').trim().toLowerCase();
  let centered = false;

  geoLayer = L.geoJSON(geo, {
    style: f=>{
      const m = (f.properties.name||'').toLowerCase()===uc;
      return{
        color:       m ? (isDark?pcColor:primary) : (isDark?'#444':'#8fa8b8'),
        weight:      m ? 2 : 1.2,
        fillColor:   m ? primary : (isDark?'#222':'#1a1f23'),
        fillOpacity: m ? 0.45 : (isDark?0.2:0.18)
      };
    },
    onEachFeature: (f, layer)=>{
      const name = f.properties.name || 'Unknown';
      const m = name.toLowerCase()===uc;

      if(m && !centered){
        centered = true;
        mapInstance.setView(layer.getBounds().getCenter(), currentMapZoom);
        E.mapLabel.textContent = name;
        setMapClock(currentTZ);
      }

      layer.on('mouseover', e=>{ e.target.setStyle({weight:2.4,color:'#4a6070'}); });
      layer.on('mouseout',  e=>{ geoLayer.resetStyle(e.target); });
      layer.on('click', e=>{
        E.mapLabel.textContent = name;
        setMapClock(COUNTRY_TZ[name] || currentTZ);

        if(isFullscreen){
          /* FIX 5: show floating name at click point slightly above */
          showFsTip(e.latlng, name);
          /* always re-center on clicked country in fullscreen */
          mapInstance.setView(layer.getBounds().getCenter(), currentMapZoom, {animate:true});
        } else {
          /* Normal: user's country only, only if at zoom 3 */
          if(m && currentMapZoom===3){
            mapInstance.setView(layer.getBounds().getCenter(), 3, {animate:true});
          }
        }
      });
    }
  }).addTo(mapInstance);

  if(!isNaN(currentLat)){
    cityMarker = L.circleMarker([currentLat,currentLon], {
      radius:      7,
      color:       isDark ? pcColor : primary,
      weight:      2.5,
      fillColor:   isDark ? pcColor : primary,
      fillOpacity: 0.85
    }).addTo(mapInstance);
    cityMarker.bindTooltip(E.city.textContent||'Your location', {
      direction: 'top',
      className: 'map-city-tip'
    });
  }
}

async function showMap(){
  if(isNaN(currentLat)){ toast('Location unavailable', false); return; }
  const vis = E.mapBox.classList.toggle('show');
  E.mapBtn.textContent = vis ? 'Hide Map' : 'Show Map';
  if(!vis) return;
  try{
    await loadTopoJSON();
    setTimeout(async()=>{
      if(!mapInstance){
        mapInstance = L.map('map', {
          renderer:           L.canvas(),
          zoomControl:        false,
          attributionControl: false,
          dragging:           false,
          scrollWheelZoom:    false,
          doubleClickZoom:    false,
          boxZoom:            false,
          keyboard:           false,
          touchZoom:          false
        }).setView([currentLat,currentLon], currentMapZoom);
        mapInstance.on('zoomend', ()=>{ updateZoomUI(mapInstance.getZoom()); });
      }
      renderMap(await loadWorldGeo());
      mapInstance.invalidateSize();
      updateZoomUI(currentMapZoom);
    }, 120);
  }catch(e){ toast('Map failed to load', false); console.error(e); }
}
E.mapBtn.addEventListener('click', showMap);

/* ── Reload ── */
E.reloadBtn.addEventListener('click', ()=>{
  if(isLoading){ toast('Please wait...', null); return; }
  currentLat = NaN; currentLon = NaN;
  clearInterval(mapClockTimer); mapClockTimer = null; E.mapTime.textContent = '';
  if(mapInstance){ mapInstance.remove(); mapInstance = null; }
  geoLayer = null; cityMarker = null; fsTooltip = null;
  if(isFullscreen) toggleFullscreen();
  if(E.mapBox.classList.contains('show')){ E.mapBox.classList.remove('show'); E.mapBtn.textContent = 'Show Map'; }
  loadMyIP();
});

/* ── Init ── */
initTheme();
updateZoomUI(currentMapZoom);
loadMyIP();
