const $ = (id) => document.getElementById(id);

/* ===== Ajuste dinámico topbar ===== */
(function(){
  let t = null;
  function updateTopbarVar(){
    const tb = document.querySelector(".topbar");
    if(!tb) return;
    document.documentElement.style.setProperty("--topbarH", tb.offsetHeight + "px");
  }
  try{
    const isTv = window.matchMedia && window.matchMedia("(hover: none)").matches;
    if(isTv) document.documentElement.classList.add("isTv");
  }catch{}
  window.addEventListener("load", updateTopbarVar, { once:true });
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(updateTopbarVar, 120);
  });
})();

// ===== Filtros Películas (género + texto) =====
let MOVIE_GENRE = "ALL";
let CHRISTIAN_CATALOG = "ALL";
let CHRISTIAN_LANGUAGE = "ALL";
let CHRISTIAN_COUNTRY = "ALL";

function normText(s=""){
  return String(s)
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .trim();
}

function isChristianCategory(catId){
  return catId === "cristianos-canales";
}

function isMoviesCategory(catId){
  // ajustá si tu id real de películas es otro
  return catId === "pelis-legales";
}

let CFG = null;
let PLAYLIST = [];
let currentIndex = -1;

let DETAIL_ITEM = null;
let DETAIL_CAT_ID = "";
let DETAIL_SERIES_ID = "";


let lastFocusMain = null;
let lastFocusGrid = null;
let pushedPlayerState = false;

let hudTimer = null;
let HUD_HIDE_MS = 6500;

/* --- YouTube unlock --- */
let ytSoundUnlocked = false;
let ytPendingVideoId = null;
let isCurrentYouTube = false;

/* --- video.js --- */
let vjsPlayer = null;

/* --- Series view state --- */
let currentSeries = null;      // objeto serie seleccionado
let currentSeriesCatId = "";   // catId desde donde venimos (ej: "series-legales")

function toAbsUrl(path){
  if(!path) return "";

  // Si ya es URL absoluta
  if(/^https?:\/\//i.test(path)) return path;

  // GitHub Pages base (sirve también en local)
  const base = new URL(document.baseURI);

  // Normaliza: si viene "/assets/..." le saca el leading slash
  if(path.startsWith("/")) path = path.slice(1);

  // Si viene SOLO el nombre del archivo (ej: "a-123.webp"), asumimos cache_icons
  if(!path.includes("/")){
    path = `assets/cache_icons/${path}`;
  }

  // Si viene "cache_icons/..." sin "assets/"
  if(path.startsWith("cache_icons/")){
    path = `assets/${path}`;
  }

  return new URL(path, base).href;
}

function setBrand(brand){
  if(!brand) return;
  if(brand.accent) document.documentElement.style.setProperty("--accent", brand.accent);
  if(brand.background){
    const abs = toAbsUrl(brand.background);
    document.documentElement.style.setProperty("--bg", `url("${abs}")`);
  }
  if(Number.isFinite(brand.hudAutoHideMs)){
    HUD_HIDE_MS = Math.max(1500, brand.hudAutoHideMs);
  }
}

function isPlayerOpen(){ return $("player")?.classList.contains("show"); }
function isGridOpen(){ return $("playerGrid") && !$("playerGrid").hidden; }
function isCategoryOpen(){ return $("categoryView") && !$("categoryView").hidden; }
function isEpisodeOpen(){ return $("episodeView") && !$("episodeView").hidden; }

function getCatFromUrl(){
  const sp = new URLSearchParams(window.location.search);
  return sp.get("cat") || "";
}
function getSeriesFromUrl(){
  const sp = new URLSearchParams(window.location.search);
  return sp.get("series") || "";
}

function setRouteParams({catId, seriesId}){
  const url = new URL(window.location.href);
  if(catId) url.searchParams.set("cat", catId);
  else url.searchParams.delete("cat");
  if(seriesId) url.searchParams.set("series", seriesId);
  else url.searchParams.delete("series");
  history.pushState({ selahCat: catId || null, selahSeries: seriesId || null }, "", url.toString());
}

/* ====== Botón sonido YouTube ====== */
function setSoundButtonState(){
  const b = $("btnSound");
  if(!b) return;
  b.style.display = isCurrentYouTube ? "inline-block" : "none";
  if(!isCurrentYouTube) return;
  b.textContent = ytSoundUnlocked ? "🔊 Sonido OK" : "🔊 Activar sonido";
  b.setAttribute("aria-label", ytSoundUnlocked ? "Sonido habilitado" : "Activar sonido");
}

function makeCard({title, desc, icon, tag, onClick}){
  const card = document.createElement("div");
  card.className = "card";
  card.tabIndex = 0;

  const safeTitle = title || "";
  const safeDesc  = desc  || "";

  // ✅ normaliza ruta (soporta icon URL absoluta y rutas relativas)
  const iconSrc = toAbsUrl(icon) || toAbsUrl("assets/logo-header.png");

  card.innerHTML = `
    <img src="${iconSrc}" alt="${safeTitle}">
    <div class="cardBody">
      <h3>${safeTitle}</h3>
      ${safeDesc ? `<p class="cardDesc">${safeDesc}</p>` : ``}
      ${tag ? `<div class="badge">${tag}</div>` : ``}
    </div>
  `;

  // ✅ fallback si la imagen falla
  const img = card.querySelector("img");
  img.addEventListener("error", () => {
    img.onerror = null;
    img.src = toAbsUrl("assets/logo-header.png");
  });

  card.addEventListener("focus", () => {
    if(isPlayerOpen()){
      if(!isGridOpen()) lastFocusGrid = card;
    } else {
      lastFocusMain = card;
    }
  });

  card.addEventListener("click", onClick);
  card.addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === " "){
      e.preventDefault();
      onClick();
    }
  });

  return card;
}

/* ============ VIDEO.JS INIT ============ */
function ensureVideoJS(){
  const el = $("videoPlayer");
  if(!el) return null;
  if(!window.videojs) return null;
  if(vjsPlayer) return vjsPlayer;

  vjsPlayer = window.videojs(el, {
    controls: true,
    autoplay: true,
    preload: "auto",
    playsinline: true,
    fluid: true,
    responsive: true,
    html5: {
      vhs: {
        enableLowInitialPlaylist: true,
        smoothQualityChange: true,
        overrideNative: true
      },
      nativeAudioTracks: false,
      nativeVideoTracks: false
    }
  });

  vjsPlayer.on("error", () => {
    const err = vjsPlayer.error();
    console.warn("video.js error:", err);
  });

  return vjsPlayer;
}

/* ============ PLAYER HELPERS ============ */
async function requestFullscreen(el){
  try{
    if(el.requestFullscreen) await el.requestFullscreen();
    else if(el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  }catch{}
}
function exitFullscreenSafe(){
  try{
    if(document.fullscreenElement) document.exitFullscreen();
    else if(document.webkitFullscreenElement) document.webkitExitFullscreen();
  }catch{}
}

function stopPlayers(){
  const iframe = $("iframePlayer");
  if(iframe){
    iframe.src = "";
    iframe.style.display = "none";
  }

  if(vjsPlayer){
    try{
      vjsPlayer.pause();
      vjsPlayer.src([]);
      vjsPlayer.reset();
    }catch{}
  }
  const v = $("videoPlayer");
  if(v) v.style.display = "none";

  ytPendingVideoId = null;
  isCurrentYouTube = false;
  setSoundButtonState();
}

function setNowPlaying(text){
  const el = $("nowPlaying");
  if(el) el.textContent = text || "";
}

function showHudAndArmTimer(forceKeep=false){
  const player = $("player");
  if(!player) return;

  // HUD visible => let clicks go to controls/videojs UI
  player.classList.remove("hideHud");
  const tap = $("playerTap");
  if(tap) tap.style.pointerEvents = "none";

  if(hudTimer) clearTimeout(hudTimer);
  if(forceKeep) return;

  hudTimer = setTimeout(() => {
    if(isPlayerOpen() && !isGridOpen()){
      // HUD hidden => enable tap layer to "wake" the HUD again
      player.classList.add("hideHud");
      const tap2 = $("playerTap");
      if(tap2) tap2.style.pointerEvents = "auto";
    }
  }, HUD_HIDE_MS);
}

/* History back (player) */
function pushPlayerState(){
  if(pushedPlayerState) return;
  try{
    history.pushState({ selahPlayer: true }, "");
    pushedPlayerState = true;
  }catch{}
}
window.addEventListener("popstate", () => {
  if(isPlayerOpen()){
    closePlayer(false);
    return;
  }
  renderByRoute();
});

function openPlayer(){
  const player = $("player");
  player.classList.add("show");
  player.classList.remove("hideHud");
  player.setAttribute("aria-hidden", "false");

  $("iframePlayer").tabIndex = -1;
  $("videoPlayer").tabIndex = -1;

  pushPlayerState();
  requestFullscreen(player);
  showHudAndArmTimer(false);
  setTimeout(() => $("btnBack")?.focus(), 80);
}

function closePlayer(popHistory = true){
  stopPlayers();
  $("player").classList.remove("show");
  $("player").setAttribute("aria-hidden", "true");
  hideGrid();
  exitFullscreenSafe();

  if(hudTimer) { clearTimeout(hudTimer); hudTimer = null; }

  if(popHistory){
    if(pushedPlayerState){
      pushedPlayerState = false;
      try{ history.back(); }catch{}
    }
  }else{
    pushedPlayerState = false;
  }

  setTimeout(() => (lastFocusMain || document.querySelector(".card"))?.focus(), 80);
}

/* ============ TYPES ============ */
function extractYouTubeId(urlOrId){
  if(!urlOrId) return null;
  if(/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
  try{
    const u = new URL(urlOrId);
    if(u.hostname.includes("youtube.com") && u.pathname === "/watch") return u.searchParams.get("v");
    if(u.hostname.includes("youtube.com") && u.pathname.startsWith("/live/")){
      return u.pathname.split("/live/")[1]?.split(/[?/]/)[0] || null;
    }
    if(u.hostname === "youtu.be") return u.pathname.replace("/", "").split(/[?/]/)[0] || null;
  }catch{}
  return null;
}

function youtubeEmbedUrl(videoId, muted){
  const qs = `autoplay=1&mute=${muted ? 1 : 0}&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1&enablejsapi=1`;
  return `https://www.youtube-nocookie.com/embed/${videoId}?${qs}`;
}

function normalizeType(item){
  const t = (item.type || "").toLowerCase();
  if(t) return t;

  const u = String(item.url || "");
  if(u.includes(".m3u8")) return "hls";
  if(u.match(/\.mp4(\?|$)/i)) return "mp4";
  if(u.match(/\.mp3(\?|$)|\.aac(\?|$)|\.m4a(\?|$)/i)) return "audio";
  if(extractYouTubeId(u)) return "youtube";
  return "web";
}

function isMediaCategory(catId){
  return catId === "pelis-legales" || catId === "series-legales";
}

function getMetaValue(item, key){
  const v = item?.[key];
  if(v === undefined || v === null) return "";
  if(Array.isArray(v)) return v.filter(Boolean).join(", ");
  return String(v);
}

async function getSynopsis(item){
  const raw = (item?.desc || "").trim();
  if(raw.length >= 30) return raw;

  // fallback Wikipedia ES (cacheado)
  try{
    const title = (item?.wikiTitle || item?.name || "").trim();
    if(!title) return raw || "—";
    const cacheKey = "wiki_sum::" + title.toLowerCase();
    const cached = localStorage.getItem(cacheKey);
    if(cached){
      const obj = JSON.parse(cached);
      if(obj?.t && (Date.now() - obj.t) < 1000*60*60*24*30) return obj.v || "—";
    }
    const url = "https://es.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title);
    const r = await fetch(url, { mode:"cors" });
    if(!r.ok) throw new Error("wiki "+r.status);
    const j = await r.json();
    const sum = (j?.extract || "").trim();
    if(sum){
      localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), v: sum }));
      return sum;
    }
  }catch(e){}
  return raw || "—";
}


/* ============ YT AUDIO UNLOCK ============ */
function unlockYoutubeAudioNow(){
  const iframe = $("iframePlayer");
  if(!iframe || iframe.style.display !== "block") return false;
  if(!ytPendingVideoId) return false;

  ytSoundUnlocked = true;
  setSoundButtonState();
  iframe.src = youtubeEmbedUrl(ytPendingVideoId, false);
  return true;
}

/* ============ PLAY ============ */
function playChannelByIndex(idx){
  if(!PLAYLIST.length) return;

  if(idx < 0) idx = PLAYLIST.length - 1;
  if(idx >= PLAYLIST.length) idx = 0;
  currentIndex = idx;

  const ch = PLAYLIST[currentIndex];
  setNowPlaying(`${ch.name || "Reproduciendo"} (${currentIndex+1}/${PLAYLIST.length})`);

  stopPlayers();
  openPlayer();

  const type = normalizeType(ch);

  if(type === "web"){
    const iframe = $("iframePlayer");
    iframe.allow = "autoplay; fullscreen; encrypted-media";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.src = ch.url;
    iframe.style.display = "block";
    isCurrentYouTube = false;
    setSoundButtonState();
    showHudAndArmTimer(false);
    setTimeout(() => $("btnBack")?.focus(), 120);
    return;
  }

  if(type === "youtube"){
    const videoId = extractYouTubeId(ch.url);
    if(!videoId){
      const iframe = $("iframePlayer");
      iframe.src = ch.url;
      iframe.style.display = "block";
      isCurrentYouTube = false;
      setSoundButtonState();
      showHudAndArmTimer(false);
      return;
    }

    ytPendingVideoId = videoId;
    isCurrentYouTube = true;

    const iframe = $("iframePlayer");
    iframe.allow = "autoplay; fullscreen; encrypted-media";
    iframe.referrerPolicy = "origin";
    setSoundButtonState();

    const startMuted = !ytSoundUnlocked;
    iframe.src = youtubeEmbedUrl(videoId, startMuted);
    iframe.style.display = "block";

    showHudAndArmTimer(false);
    setTimeout(() => {
      if(!ytSoundUnlocked) $("btnSound")?.focus();
      else $("btnBack")?.focus();
    }, 140);
    return;
  }

  // ✅ mp4 / hls / audio via video.js
  const v = $("videoPlayer");
  v.style.display = "block";
  isCurrentYouTube = false;
  setSoundButtonState();

  const player = ensureVideoJS();
  if(!player){
    alert("No se pudo inicializar video.js");
    closePlayer(true);
    return;
  }

  const srcType =
    type === "hls" ? "application/x-mpegURL" :
    type === "mp4" ? "video/mp4" :
    type === "audio" ? "audio/mpeg" :
    "";

  player.src([{ src: ch.url, type: srcType }]);
  player.play().catch(()=>{});

  showHudAndArmTimer(false);
  setTimeout(() => $("btnBack")?.focus(), 120);
}

function nextChannel(){ playChannelByIndex(currentIndex + 1); }
function prevChannel(){ playChannelByIndex(currentIndex - 1); }

/* ============ GRID INSIDE PLAYER ============ */
function showGrid(){
  $("playerGrid").hidden = false;
  const grid = $("gridInsidePlayer");
  grid.innerHTML = "";

  PLAYLIST.forEach((ch, i) => {
    grid.appendChild(makeCard({
      title: ch.name,
      desc: ch.category ? ch.category : "",
      icon: ch.icon,
      tag: ch.category || ch.tag || "",
      onClick: () => {
        hideGrid();
        playChannelByIndex(i);
      }
    }));
  });

  showHudAndArmTimer(true);
  setTimeout(() => (grid.querySelector(".card") || $("btnCloseGrid"))?.focus(), 80);
}
function hideGrid(){
  if($("playerGrid")) $("playerGrid").hidden = true;
  showHudAndArmTimer(false);
  setTimeout(() => $("btnBack")?.focus(), 50);
}

/* HUD botones */
$("btnBack")?.addEventListener("click", () => closePlayer(true));
$("btnNext")?.addEventListener("click", () => { showHudAndArmTimer(false); nextChannel(); });
$("btnPrev")?.addEventListener("click", () => { showHudAndArmTimer(false); prevChannel(); });
$("btnGrid")?.addEventListener("click", () => { showHudAndArmTimer(true); showGrid(); });
$("btnCloseGrid")?.addEventListener("click", () => { showHudAndArmTimer(false); hideGrid(); });

$("btnSound")?.addEventListener("click", () => {
  unlockYoutubeAudioNow();
  showHudAndArmTimer(false);
});
$("playerTap")?.addEventListener("pointerdown", (e) => {
  if(!isPlayerOpen()) return;

  const player = $("player");
  const hudHidden = !!player && player.classList.contains("hideHud");

  // Only use the tap layer to "wake" the HUD.
  // When HUD is visible, let the click go to Video.js controls.
  if(hudHidden){
    try{ e.preventDefault(); }catch{}
    unlockYoutubeAudioNow(); // only matters for YouTube/gesture-unlock
    showHudAndArmTimer(false);
  }
}, { passive:false });

/* Key handling TV */
document.addEventListener("keydown", (e) => {
  if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer(false);

  const key = e.key;
  const isBack =
    key === "Escape" || key === "Backspace" || key === "GoBack" ||
    key === "BrowserBack" || key === "Back";

  // Back desde episodios
  if(!isPlayerOpen() && isEpisodeOpen() && isBack){
    e.preventDefault();
    // vuelve a la grilla de series (misma categoría)
    setRouteParams({ catId: currentSeriesCatId || getCatFromUrl(), seriesId: "" });
    renderByRoute();
    return;
  }

  // Back desde categoría
  if(!isPlayerOpen() && isCategoryOpen() && isBack){
    e.preventDefault();
    setRouteParams({ catId: "", seriesId: "" });
    renderByRoute();
    return;
  }

  if(!isPlayerOpen()) return;

  if(isBack){
    e.preventDefault();
    if(isGridOpen()) hideGrid();
    else closePlayer(true);
    return;
  }

  if(key === "Enter"){
    const a = document.activeElement;
    if(a && typeof a.click === "function"){
      e.preventDefault();
      a.click();
      return;
    }

    e.preventDefault();
    if(isCurrentYouTube && !ytSoundUnlocked){
      unlockYoutubeAudioNow();
      showHudAndArmTimer(false);
      return;
    }
    $("player").classList.remove("hideHud");
    showHudAndArmTimer(false);
  }
}, true);

/* ============ DATA + RENDER ============ */
function findCategoryById(catId){
  return (CFG?.categories || []).find(c => c.id === catId) || null;
}

function buildPlaylistFromCategory(cat){
  const list = [];
  (cat?.items || []).forEach(item => {
    const type = normalizeType(item);
    // reproductibles directos
    if(type === "youtube" || type === "hls" || type === "mp4" || type === "audio" || type === "web"){
      // ⚠️ si es “serie” con episodios, no se agrega acá (se reproduce por episodio)
      if(Array.isArray(item.episodes) && item.episodes.length) return;
      list.push({ ...item, type, category: cat.name || "" });
    }
  });
  return list;
}

function renderShortcuts(){
  const shortcutsEl = $("shortcuts");
  if(!shortcutsEl) return;
  shortcutsEl.innerHTML = "";
  (CFG.shortcuts || []).forEach(s => {
    shortcutsEl.appendChild(makeCard({
      title: s.name,
      desc: s.desc,
      icon: s.icon,
      tag: "Acceso",
      onClick: () => window.open(s.url, "_blank", "noopener")
    }));
  });
}

function renderHomeCategories(){
  const homeEl = $("homeCategories");
  if(!homeEl) return;
  homeEl.innerHTML = "";

  const cats = (CFG.homeCategories && CFG.homeCategories.length)
    ? CFG.homeCategories
    : (CFG.categories || []).map(c => ({
        id: c.id,
        name: c.name,
        desc: `${(c.items || []).length} items`,
        icon: (c.items?.[0]?.icon) || "assets/logo-header.png"
      }));

  cats.forEach(c => {
    const cat = findCategoryById(c.id);
    const count = (cat?.items || []).length;
    homeEl.appendChild(makeCard({
      title: c.name || "Categoría",
      desc: c.desc || `${count} items`,
      icon: c.icon || "assets/logo-header.png",
      tag: `${count} ítems`,
      onClick: () => { setRouteParams({ catId: c.id, seriesId: "" }); renderByRoute(); }
    }));
  });
}

function hideAllViews(){
  const shortcutsBlock = $("shortcutsBlock");
  if(shortcutsBlock) shortcutsBlock.hidden = true;
  $("homeCategoriesBlock").hidden = true;
  $("categoryView").hidden = true;
  $("episodeView").hidden = true;
  const dv = $("detailView");
  if(dv) dv.hidden = true;
}

function renderHome(){
  const shortcutsBlock = $("shortcutsBlock");
  if(shortcutsBlock) shortcutsBlock.hidden = false;

  $("homeCategoriesBlock").hidden = false;
  $("categoryView").hidden = true;
  $("episodeView").hidden = true;

  renderShortcuts();
  renderHomeCategories();

  setTimeout(() => {
    const first = document.querySelector("#shortcuts .card") || document.querySelector("#homeCategories .card");
    first?.focus();
  }, 80);
}

/* ✅ NUEVO: vista episodios */
function renderEpisodeView(catId, seriesId){
  hideAllViews();
  $("episodeView").hidden = false;

  const cat = findCategoryById(catId);
  if(!cat){
    $("episodeTitle").textContent = "Episodios";
    $("episodeGrid").innerHTML = "";
    $("episodeGrid").appendChild(makeCard({
      title: "Categoría no encontrada",
      desc: "Volvé y elegí otra categoría.",
      icon: "assets/logo-header.png",
      tag: "Error",
      onClick: () => {}
    }));
    setTimeout(() => $("btnBackToSeries")?.focus(), 60);
    return;
  }

  currentSeriesCatId = catId;

  const series = (cat.items || []).find(x => (x.id || "") === seriesId) || null;
  currentSeries = series;

  $("episodeTitle").textContent = series?.name ? `Episodios • ${series.name}` : "Episodios";

  const grid = $("episodeGrid");
  grid.innerHTML = "";

  const eps = series?.episodes || [];
  if(!eps.length){
    grid.appendChild(makeCard({
      title: "Sin episodios",
      desc: "Esta serie no tiene episodios cargados.",
      icon: series?.icon || "assets/logo-header.png",
      tag: "Info",
      onClick: () => {}
    }));
    setTimeout(() => $("btnBackToSeries")?.focus(), 60);
    return;
  }

  // playlist = episodios para poder usar next/prev/grilla
  PLAYLIST = eps.map(ep => ({
    name: ep.name,
    url: ep.url,
    icon: ep.icon || series.icon || "assets/logo-header.png",
    desc: ep.desc || "",
    type: normalizeType(ep),
    category: series.name || "Serie"
  }));
  currentIndex = -1;

  setupEpisodeSearch(eps);
  renderEpisodeItems(eps, "");

  setTimeout(() => (grid.querySelector(".card") || $("btnBackToSeries"))?.focus(), 80);
}


/* Vista categoría (pelis, series, etc.) */
function renderDetailView(catId, item){
  hideAllViews();
  $("detailView").hidden = false;

  DETAIL_ITEM = item || null;
  DETAIL_CAT_ID = catId || "";
  DETAIL_SERIES_ID = item?.id || item?.name || "";

  $("detailTitle").textContent = item?.name || "Detalle";

  // poster
  const posterEl = $("detailPosterImg");
  const posterSrc = toAbsUrl(item?.poster || item?.icon || "");
  posterEl.src = posterSrc || toAbsUrl("assets/logo-header.png");
  posterEl.alt = item?.name || "";

  // meta
  const year = getMetaValue(item, "year");
  const dur  = getMetaValue(item, "duration");
  const gen  = getMetaValue(item, "genre") || getMetaValue(item, "genres");
  $("detailYear").textContent = year || "—";
  $("detailDuration").textContent = dur || "—";
  $("detailGenre").textContent = gen || "—";

  // actions
  const hasEpisodes = Array.isArray(item?.episodes) && item.episodes.length;
  $("btnDetailEpisodes").hidden = !hasEpisodes;

  // synopsis async
  $("detailDescText").textContent = "Cargando…";
  getSynopsis(item).then(txt => {
    // si el usuario ya se fue, no pisar
    if($("detailView").hidden) return;
    $("detailDescText").textContent = txt || "—";
  });

  // focus
  setTimeout(() => $("btnDetailPlay")?.focus(), 60);
}

function backFromDetail(){
  if(DETAIL_CAT_ID){
    // volver a categoría sin tocar ruta (mantiene lo que ya funcionaba)
    renderCategoryView(DETAIL_CAT_ID);
    return;
  }
  renderHome();
}


function renderCategoryView(catId){
  hideAllViews();

  const cat = findCategoryById(catId);
  $("categoryView").hidden = false;
  $("categoryTitle").textContent = cat?.name || "Categoría";

  const grid = $("categoryGrid");
  grid.innerHTML = "";

  if(!cat){
    grid.appendChild(makeCard({
      title: "Categoría no encontrada",
      desc: "Volvé y elegí otra categoría.",
      icon: "assets/logo-header.png",
      tag: "Error",
      onClick: () => {}
    }));
    PLAYLIST = [];
    setTimeout(() => $("btnBackToHome")?.focus(), 60);
    return;
  }

  // render + buscador
  setupCategorySearch(catId, cat.items || []);
  renderCategoryItems(catId, cat.items || [], "");

  setTimeout(() => $("btnBackToHome")?.focus(), 80);
}


/* Ruteo */
function renderByRoute(){
  const catId = getCatFromUrl();
  const seriesId = getSeriesFromUrl();

  if(catId && seriesId){
    renderEpisodeView(catId, seriesId);
    return;
  }
  if(catId){
    renderCategoryView(catId);
    return;
  }
  renderHome();
}

/* Botones volver */
$("btnBackToHome")?.addEventListener("click", () => {
  setRouteParams({ catId: "", seriesId: "" });
  renderByRoute();
});

$("btnBackToSeries")?.addEventListener("click", () => {
  setRouteParams({ catId: currentSeriesCatId || getCatFromUrl(), seriesId: "" });
  renderByRoute();
});

// Detalle: volver / acciones
$("btnBackFromDetail")?.addEventListener("click", backFromDetail);

$("btnDetailPlay")?.addEventListener("click", () => {
  const item = DETAIL_ITEM;
  const catId = DETAIL_CAT_ID;
  if(!item) return;

  const type = normalizeType(item);
  if(type === "web"){
    openPlayer();
    stopPlayers();
    const iframe = $("iframePlayer");
    iframe.allow = "autoplay; fullscreen; encrypted-media";
    iframe.src = item.url;
    iframe.style.display = "block";
    setNowPlaying(item.name || "Web");
    showHudAndArmTimer(false);
    return;
  }

  const cat = findCategoryById(catId);
  PLAYLIST = buildPlaylistFromCategory(cat);
  const idx = PLAYLIST.findIndex(x => x.url === item.url && x.name === item.name);
  if(idx >= 0) playChannelByIndex(idx);
  else {
    // fallback: reproducir directo como single
    PLAYLIST = [{ name:item.name, url:item.url, icon:item.icon, desc:item.desc, type: normalizeType(item), category: cat?.name || "" }];
    playChannelByIndex(0);
  }
});

$("btnDetailEpisodes")?.addEventListener("click", () => {
  const catId = DETAIL_CAT_ID;
  const seriesId = DETAIL_ITEM?.id || DETAIL_ITEM?.name;
  if(!catId || !seriesId) return;
  setRouteParams({ catId, seriesId });
  renderByRoute();
});

$("btnDetailTrailer")?.addEventListener("click", () => {
  const item = DETAIL_ITEM;
  if(!item) return;
  const url = (item.trailer || "").trim();
  const q = encodeURIComponent((item.name || "") + " trailer");
  const target = url || ("https://www.youtube.com/results?search_query=" + q);
  window.open(target, "_blank");
});

// Teclas Back/Escape cuando estás en detalle
document.addEventListener("keydown", (e) => {
  if(($("detailView") && !$("detailView").hidden) && (e.key === "Escape" || e.key === "Backspace")){
    e.preventDefault();
    backFromDetail();
  }
});

/* ============ LOAD CONFIG (multi-path) ============ */
const CONFIG_CANDIDATES = [
  "config/channels.enriched.json",       
  "config/channels.with_assets.json",
  "config/channels.json",
  "channels.json"
];

function looksLikeCfg(obj){
  return obj && typeof obj === "object" && Array.isArray(obj.categories);
}

async function loadFirstValidConfig(){
  for(const url of CONFIG_CANDIDATES){
    try{
      const r = await fetch(url + "?v=" + Date.now(), { cache: "no-store" });
      if(!r.ok) continue;
      const cfg = await r.json();
      if(looksLikeCfg(cfg)) return cfg;
    }catch{}
  }
  throw new Error("No se pudo cargar ningún channels.json válido.");
}

loadFirstValidConfig()
  .then(cfg => {
    CFG = cfg;
    setBrand(cfg.brand);
    renderByRoute();
  })
  .catch(err => {
    console.error("Error cargando config:", err);
    alert("No se pudo cargar la configuración de canales. Revisá que exista channels.json o config/channels.json y que sea JSON válido.");
  });

function setupCategorySearch(catId, items){
  const bar = $("categoryToolbar");
  const inp = $("categorySearch");
  const clr = $("btnClearCategorySearch");
  if(!bar || !inp || !clr) return;

  const isMovies = isMoviesCategory(catId);
  const isChristian = isChristianCategory(catId);
  const enabled = isMediaCategory(catId) || isChristian;

  bar.hidden = !enabled;

  // ====== Géneros solo para Películas ======
  let genreSel = document.getElementById("categoryGenre");
  if(isMovies){
    if(!genreSel){
      genreSel = document.createElement("select");
      genreSel.id = "categoryGenre";
      genreSel.className = "categoryGenre";
      bar.insertBefore(genreSel, inp);
    }

    const set = new Set();
    (items || []).forEach(it => (it.genres || []).forEach(g => { if(g) set.add(g); }));
    const genres = ["ALL", ...Array.from(set).sort((a,b)=>a.localeCompare(b))];

    genreSel.innerHTML = genres.map(g =>
      `<option value="${g}">${g==="ALL" ? "Todos los géneros" : g}</option>`
    ).join("");

    genreSel.value = MOVIE_GENRE || "ALL";

    if(!genreSel.dataset.bound){
      genreSel.addEventListener("change", () => {
        MOVIE_GENRE = genreSel.value;
        const q = normText(inp.value);
        renderCategoryItems(catId, items, q);
      });
      genreSel.dataset.bound = "1";
    }
  }else{
    if(genreSel) genreSel.remove();
    MOVIE_GENRE = "ALL";
  }

  // ====== Catálogo solo para Contenido Cristiano ======
  let catalogSel = document.getElementById("categoryCatalog");
  if(isChristian){
    if(!catalogSel){
      catalogSel = document.createElement("select");
      catalogSel.id = "categoryCatalog";
      catalogSel.className = "categoryCatalog";
      bar.insertBefore(catalogSel, inp);
    }

    const setCat = new Set();
    (items || []).forEach(it => {
      const c = String(it?.catalog || "").trim();
      if(c) setCat.add(c);
    });

    const catalogs = ["ALL", ...Array.from(setCat).sort((a,b)=>a.localeCompare(b))];
    catalogSel.innerHTML = catalogs.map(c =>
      `<option value="${c}">${c === "ALL" ? "Todo el contenido" : c}</option>`
    ).join("");

    catalogSel.value = CHRISTIAN_CATALOG || "ALL";

    if(!catalogSel.dataset.bound){
      catalogSel.addEventListener("change", () => {
        CHRISTIAN_CATALOG = catalogSel.value;
        const q = normText(inp.value);
        renderCategoryItems(catId, items, q);
      });
      catalogSel.dataset.bound = "1";
    }
  }else{
    if(catalogSel) catalogSel.remove();
    CHRISTIAN_CATALOG = "ALL";
  }

  // ====== Idioma solo para Contenido Cristiano ======
  let languageSel = document.getElementById("categoryLanguage");
  if(isChristian){
    if(!languageSel){
      languageSel = document.createElement("select");
      languageSel.id = "categoryLanguage";
      languageSel.className = "categoryLanguage";
      bar.insertBefore(languageSel, inp);
    }

    const langSet = new Set();
    (items || []).forEach(it => {
      (it.languages || []).forEach(l => { if(l) langSet.add(l); });
    });

    const langs = ["ALL", ...Array.from(langSet).sort((a,b)=>a.localeCompare(b))];
    languageSel.innerHTML = langs.map(l =>
      `<option value="${l}">${l === "ALL" ? "Todos los idiomas" : l}</option>`
    ).join("");

    languageSel.value = CHRISTIAN_LANGUAGE || "ALL";

    if(!languageSel.dataset.bound){
      languageSel.addEventListener("change", () => {
        CHRISTIAN_LANGUAGE = languageSel.value;
        const q = normText(inp.value);
        renderCategoryItems(catId, items, q);
      });
      languageSel.dataset.bound = "1";
    }
  }else{
    if(languageSel) languageSel.remove();
    CHRISTIAN_LANGUAGE = "ALL";
  }

  // ====== País solo para Contenido Cristiano ======
  let countrySel = document.getElementById("categoryCountry");
  if(isChristian){
    if(!countrySel){
      countrySel = document.createElement("select");
      countrySel.id = "categoryCountry";
      countrySel.className = "categoryCountry";
      bar.insertBefore(countrySel, inp);
    }

    const countrySet = new Set();
    (items || []).forEach(it => {
      const c = String(it?.country || "").trim();
      if(c) countrySet.add(c);
    });

    const countries = ["ALL", ...Array.from(countrySet).sort((a,b)=>a.localeCompare(b))];
    countrySel.innerHTML = countries.map(c =>
      `<option value="${c}">${c === "ALL" ? "Todos los países" : c}</option>`
    ).join("");

    countrySel.value = CHRISTIAN_COUNTRY || "ALL";

    if(!countrySel.dataset.bound){
      countrySel.addEventListener("change", () => {
        CHRISTIAN_COUNTRY = countrySel.value;
        const q = normText(inp.value);
        renderCategoryItems(catId, items, q);
      });
      countrySel.dataset.bound = "1";
    }
  }else{
    if(countrySel) countrySel.remove();
    CHRISTIAN_COUNTRY = "ALL";
  }

  if(!enabled) return;

  inp.value = "";

  if(!inp.dataset.bound){
    inp.addEventListener("input", () => {
      const q = normText(inp.value);
      renderCategoryItems(catId, items, q);
    });
    inp.dataset.bound = "1";
  }

  if(!clr.dataset.bound){
    clr.addEventListener("click", () => {
      inp.value = "";
      inp.dispatchEvent(new Event("input"));
      inp.focus();
    });
    clr.dataset.bound = "1";
  }
}

function renderCategoryItems(catId, items, query){
  const grid = $("categoryGrid");
  grid.innerHTML = "";
  const q = normText(query || "");

  // ===== Películas: género =====
  let selectedGenre = "ALL";
  const genreSel = document.getElementById("categoryGenre");
  if(isMoviesCategory(catId) && genreSel){
    selectedGenre = genreSel.value || "ALL";
    MOVIE_GENRE = selectedGenre;
  }

  // ===== Cristianos: catálogo / idioma / país =====
  let selectedCatalog = "ALL";
  let selectedLanguage = "ALL";
  let selectedCountry = "ALL";

  const catalogSel = document.getElementById("categoryCatalog");
  const languageSel = document.getElementById("categoryLanguage");
  const countrySel = document.getElementById("categoryCountry");

  if(isChristianCategory(catId)){
    selectedCatalog = catalogSel ? (catalogSel.value || "ALL") : "ALL";
    selectedLanguage = languageSel ? (languageSel.value || "ALL") : "ALL";
    selectedCountry = countrySel ? (countrySel.value || "ALL") : "ALL";

    CHRISTIAN_CATALOG = selectedCatalog;
    CHRISTIAN_LANGUAGE = selectedLanguage;
    CHRISTIAN_COUNTRY = selectedCountry;
  }

  const list = (items || []).filter(item => {
    // Películas: filtro por género
    if(isMoviesCategory(catId) && selectedGenre !== "ALL"){
      const gs = Array.isArray(item?.genres) ? item.genres : [];
      if(!gs.includes(selectedGenre)) return false;
    }

    // Cristianos: catálogo
    if(isChristianCategory(catId)){
      if(selectedCatalog !== "ALL"){
        const c = String(item?.catalog || "").trim();
        if(c !== selectedCatalog) return false;
      }

      if(selectedLanguage !== "ALL"){
        const langs = Array.isArray(item?.languages) ? item.languages : [];
        if(!langs.includes(selectedLanguage)) return false;
      }

      if(selectedCountry !== "ALL"){
        const ctry = String(item?.country || "").trim();
        if(ctry !== selectedCountry) return false;
      }
    }

    // búsqueda general
    if(!q) return true;

    const n = normText(item?.name || "");
    const d = normText(item?.desc || "");
    const c = normText(item?.catalog || "");
    const ctry = normText(item?.country || "");
    const langs = normText(Array.isArray(item?.languages) ? item.languages.join(" ") : "");

    return (
      n.includes(q) ||
      d.includes(q) ||
      c.includes(q) ||
      ctry.includes(q) ||
      langs.includes(q)
    );
  });

  const cat = findCategoryById(catId);
  PLAYLIST = buildPlaylistFromCategory(cat);

  list.forEach(item => {
    const hasEpisodes = Array.isArray(item.episodes) && item.episodes.length;
    const type = normalizeType(item);

    grid.appendChild(makeCard({
      title: item.name,
      desc: item.desc || "",
      icon: item.poster || item.icon || "",
      tag: hasEpisodes ? "SERIE" : ((type === "web") ? "WEB" : type.toUpperCase()),
      onClick: () => {
        if(isMediaCategory(catId)){
          renderDetailView(catId, item);
          return;
        }

        if(hasEpisodes){
          const seriesId = item.id || item.name;
          setRouteParams({ catId, seriesId });
          renderByRoute();
          return;
        }

        if(type === "web"){
          openPlayer();
          stopPlayers();
          const iframe = $("iframePlayer");
          iframe.allow = "autoplay; fullscreen; encrypted-media";
          iframe.src = item.url;
          iframe.style.display = "block";
          setNowPlaying(item.name || "Web");
          showHudAndArmTimer(false);
          return;
        }

        const idx = PLAYLIST.findIndex(x => x.url === item.url && x.name === item.name);
        if(idx >= 0) playChannelByIndex(idx);
        else alert("Este ítem no está listo para reproducir");
      }
    }));
  });

  if(!list.length){
    grid.appendChild(makeCard({
      title: "Sin resultados",
      desc: "Probá con otro filtro o término de búsqueda.",
      icon: "assets/logo-header.png",
      tag: "Buscar",
      onClick: () => {}
    }));
  }
}

function setupEpisodeSearch(items){
  const bar = $("episodeToolbar");
  const inp = $("episodeSearch");
  const clr = $("btnClearEpisodeSearch");
  if(!bar || !inp || !clr) return;

  bar.hidden = false;
  inp.value = "";

  if(!inp.dataset.bound){
    inp.addEventListener("input", () => {
      const q = normText(inp.value);
      renderEpisodeItems(items, q);
    });
    inp.dataset.bound = "1";
  }

  if(!clr.dataset.bound){
    clr.addEventListener("click", () => {
      inp.value = "";
      inp.dispatchEvent(new Event("input"));
      inp.focus();
    });
    clr.dataset.bound = "1";
  }
}

function renderEpisodeItems(items, query){
  const grid = $("episodeGrid");
  grid.innerHTML = "";
  const q = normText(query || "");

  const list = (items || []).filter(ep => {
    if(!q) return true;
    const n = normText(ep?.name || "");
    const d = normText(ep?.desc || "");
    return n.includes(q) || d.includes(q);
  });

  list.forEach(ep => {
    const type = normalizeType(ep);
    grid.appendChild(makeCard({
      title: ep.name,
      desc: ep.desc || "",
      icon: ep.icon,
      tag: (type === "web") ? "WEB" : type.toUpperCase(),
      onClick: () => {
        if(type === "web"){
          openPlayer();
          stopPlayers();
          const iframe = $("iframePlayer");
          iframe.allow = "autoplay; fullscreen; encrypted-media";
          iframe.src = ep.url;
          iframe.style.display = "block";
          setNowPlaying(ep.name || "Web");
          showHudAndArmTimer(false);
          return;
        }
        const idx = PLAYLIST.findIndex(x => x.url === ep.url && x.name === ep.name);
        if(idx >= 0) playChannelByIndex(idx);
        else {
          // fallback: reproducir directo
          const tmp = { name: ep.name, url: ep.url, type: normalizeType(ep), icon: ep.icon };
          PLAYLIST = [tmp];
          playChannelByIndex(0);
        }
      }
    }));
  });

  if(!list.length){
    grid.appendChild(makeCard({
      title: "Sin resultados",
      desc: "Probá con otro término.",
      icon: "assets/logo-header.png",
      tag: "Buscar",
      onClick: () => {}
    }));
  }
}


;