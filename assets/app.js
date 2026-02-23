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

let CFG = null;
let PLAYLIST = [];
let currentIndex = -1;

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

/* ====== Card robusta (acepta URL externa) ====== */
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

  player.classList.remove("hideHud");
  if(hudTimer) clearTimeout(hudTimer);

  if(forceKeep) return;

  hudTimer = setTimeout(() => {
    if(isPlayerOpen() && !isGridOpen()){
      player.classList.add("hideHud");
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
  e.preventDefault();
  unlockYoutubeAudioNow();
  showHudAndArmTimer(false);
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

  eps.forEach((ep, i) => {
    grid.appendChild(makeCard({
      title: ep.name || `Episodio ${i+1}`,
      desc: ep.desc || "",
      icon: ep.icon || series.icon,
      tag: ep.tag || "",
      onClick: () => playChannelByIndex(i)
    }));
  });

  setTimeout(() => (grid.querySelector(".card") || $("btnBackToSeries"))?.focus(), 80);
}

/* Vista categoría (pelis, series, etc.) */
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

  // playlist para items directos (pelis/canales)
  PLAYLIST = buildPlaylistFromCategory(cat);

  (cat.items || []).forEach(item => {
    const hasEpisodes = Array.isArray(item.episodes) && item.episodes.length;
    const type = normalizeType(item);

    grid.appendChild(makeCard({
      title: item.name,
      desc: item.desc || "",
      icon: item.icon,
      tag: hasEpisodes ? "SERIE" : ((type === "web") ? "WEB" : type.toUpperCase()),
      onClick: () => {
        // ✅ si es serie -> abrir episodios
        if(hasEpisodes){
          const seriesId = item.id || item.name; // ideal: que tenga id fijo en channels.json
          setRouteParams({ catId, seriesId });
          renderByRoute();
          return;
        }

        // web directo
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

        // play desde playlist directo (pelis/canales)
        const idx = PLAYLIST.findIndex(x => x.url === item.url && x.name === item.name);
        if(idx >= 0) playChannelByIndex(idx);
        else alert("Este ítem no está listo para reproducir (¿serie sin episodios?)");
      }
    }));
  });

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

/* ============ LOAD CONFIG (multi-path) ============ */
const CONFIG_CANDIDATES = [
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
