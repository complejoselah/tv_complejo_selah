const $ = (id) => document.getElementById(id);

let CFG = null;

// playlist = items reproducibles (youtube/hls) de la categoría actual
let PLAYLIST = [];
let currentIndex = -1;

let hls = null;

let lastFocusMain = null;
let lastFocusGrid = null;

let pushedPlayerState = false;

// HUD auto-hide
let hudTimer = null;
let HUD_HIDE_MS = 6500;

// --- YouTube unlock ---
let ytSoundUnlocked = false;
let ytPendingVideoId = null; // id actual para recargar con sonido

function toAbsUrl(path){
  if(!path) return "";
  if(/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  return new URL(path, window.location.href).href;
}

function setBrand(brand){
  if(!brand) return;

  if(brand.accent){
    document.documentElement.style.setProperty("--accent", brand.accent);
  }
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

function getCatFromUrl(){
  const sp = new URLSearchParams(window.location.search);
  return sp.get("cat") || "";
}

function setCatToUrl(catId){
  const url = new URL(window.location.href);
  if(catId) url.searchParams.set("cat", catId);
  else url.searchParams.delete("cat");
  history.pushState({ selahCat: catId || null }, "", url.toString());
}

function makeCard({title, desc, icon, tag, onClick}){
  const card = document.createElement("div");
  card.className = "card";
  card.tabIndex = 0;

  const safeTitle = title || "";
  const safeDesc  = desc  || "";
  const safeIcon  = icon  || "";

  card.innerHTML = `
    <img src="${safeIcon}" alt="${safeTitle}">
    <div class="cardBody">
      <h3>${safeTitle}</h3>
      ${safeDesc ? `<p class="cardDesc">${safeDesc}</p>` : ``}
      ${tag ? `<div class="badge">${tag}</div>` : ``}
    </div>
  `;

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

  const v = $("videoPlayer");
  if(v){
    try{ v.pause(); }catch{}
    v.removeAttribute("src");
    v.load();
    v.style.display = "none";
  }

  if(hls){
    try{ hls.destroy(); }catch{}
    hls = null;
  }

  ytPendingVideoId = null;
}

function setNowPlaying(text){
  const el = $("nowPlaying");
  if(el) el.textContent = text || "";
}

/* HUD autohide */
function showHudAndArmTimer(forceKeep=false){
  const player = $("player");
  if(!player) return;

  player.classList.remove("hideHud");

  if(hudTimer) clearTimeout(hudTimer);

  // Para WEB (pluto/plex/etc) conviene NO ocultar el HUD
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

  showHudAndArmTimer(true);
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

  // id directo
  if(/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;

  try{
    const u = new URL(urlOrId);

    if(u.hostname.includes("youtube.com") && u.pathname === "/watch"){
      return u.searchParams.get("v");
    }

    if(u.hostname.includes("youtube.com") && u.pathname.startsWith("/live/")){
      return u.pathname.split("/live/")[1]?.split(/[?/]/)[0] || null;
    }

    if(u.hostname === "youtu.be"){
      return u.pathname.replace("/", "").split(/[?/]/)[0] || null;
    }
  }catch{}

  return null;
}

function youtubeEmbedUrl(videoId, muted){
  // Nota: “mute=1” permite autoplay en TV WebView
  // Luego, con una interacción, recargamos con mute=0
  const qs = `autoplay=1&mute=${muted ? 1 : 0}&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1`;
  return `https://www.youtube-nocookie.com/embed/${videoId}?${qs}`;
}

function normalizeType(item){
  const t = (item.type || "").toLowerCase();
  if(t) return t;

  const u = String(item.url || "");
  if(u.includes(".m3u8")) return "hls";
  if(extractYouTubeId(u)) return "youtube";
  return "web";
}

/* ============ PLAY ============ */

function playChannelByIndex(idx){
  if(!PLAYLIST.length) return;

  if(idx < 0) idx = PLAYLIST.length - 1;
  if(idx >= PLAYLIST.length) idx = 0;
  currentIndex = idx;

  const ch = PLAYLIST[currentIndex];
  setNowPlaying(`${ch.name || "Canal"} (${currentIndex+1}/${PLAYLIST.length})`);

  stopPlayers();
  openPlayer();

  const type = normalizeType(ch);

  // WEB dentro del player -> HUD/back siempre disponible
  if(type === "web"){
    const iframe = $("iframePlayer");
    iframe.allow = "autoplay; fullscreen; encrypted-media";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.src = ch.url;
    iframe.style.display = "block";

    // No autohide en web
    showHudAndArmTimer(true);
    setTimeout(() => $("btnBack")?.focus(), 120);
    return;
  }

  if(type === "youtube"){
    const videoId = extractYouTubeId(ch.url);
    if(!videoId){
      // fallback
      const iframe = $("iframePlayer");
      iframe.src = ch.url;
      iframe.style.display = "block";
      showHudAndArmTimer(true);
      return;
    }

    ytPendingVideoId = videoId;

    const iframe = $("iframePlayer");
    iframe.allow = "autoplay; fullscreen; encrypted-media";
    iframe.referrerPolicy = "origin";

    // 1) arrancamos muteado para asegurar autoplay
    iframe.src = youtubeEmbedUrl(videoId, true);
    iframe.style.display = "block";

    // En youtube sí dejamos autohide
    showHudAndArmTimer(false);
    setTimeout(() => $("btnBack")?.focus(), 120);
    return;
  }

  if(type === "hls"){
    const video = $("videoPlayer");
    video.style.display = "block";

    // HLS nativo (Safari / algunos TV)
    if(video.canPlayType("application/vnd.apple.mpegurl")){
      video.src = ch.url;
      video.play().catch(()=>{});
      showHudAndArmTimer(true);
      setTimeout(() => $("btnBack")?.focus(), 120);
      return;
    }

    // HLS.js
    if(window.Hls && Hls.isSupported()){
      hls = new Hls();
      hls.loadSource(ch.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(()=>{});
        showHudAndArmTimer(true);
        setTimeout(() => $("btnBack")?.focus(), 120);
      });
      return;
    }

    alert("Este dispositivo/navegador no soporta HLS (.m3u8).");
    closePlayer(true);
    return;
  }
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

  showHudAndArmTimer(true);
  setTimeout(() => $("btnBack")?.focus(), 50);
}

/* ============ YT AUDIO UNLOCK ============ */
function unlockYoutubeAudioNow(){
  // recarga con mute=0 SOLO si estamos en youtube y tenemos id
  const iframe = $("iframePlayer");
  if(!iframe || iframe.style.display !== "block") return false;
  if(!ytPendingVideoId) return false;

  ytSoundUnlocked = true;
  iframe.src = youtubeEmbedUrl(ytPendingVideoId, false);
  return true;
}

/* HUD botones */
$("btnBack")?.addEventListener("click", () => closePlayer(true));
$("btnNext")?.addEventListener("click", () => { showHudAndArmTimer(true); nextChannel(); });
$("btnPrev")?.addEventListener("click", () => { showHudAndArmTimer(true); prevChannel(); });
$("btnGrid")?.addEventListener("click", () => { showHudAndArmTimer(true); showGrid(); });
$("btnCloseGrid")?.addEventListener("click", () => { showHudAndArmTimer(true); hideGrid(); });

/* Tap overlay: muestra HUD y desbloquea audio */
$("playerTap")?.addEventListener("pointerdown", (e) => {
  if(!isPlayerOpen()) return;
  e.preventDefault();
  unlockYoutubeAudioNow();
  showHudAndArmTimer(true);
}, { passive:false });

/* Reaparecer HUD ante interacción */
["pointermove","wheel"].forEach(ev => {
  document.addEventListener(ev, () => {
    if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer(true);
  }, { passive:true });
});

document.addEventListener("pointerdown", () => {
  if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer(true);
}, { passive:true });

/* Key handling TV */
document.addEventListener("keydown", (e) => {
  if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer(true);

  // Back desde vista categoría (sin player)
  if(!isPlayerOpen() && isCategoryOpen()){
    const key = e.key;
    const isBack =
      key === "Escape" || key === "Backspace" || key === "GoBack" ||
      key === "BrowserBack" || key === "Back";
    if(isBack){
      e.preventDefault();
      setCatToUrl("");
      renderByRoute();
      return;
    }
  }

  if(!isPlayerOpen()) return;

  const key = e.key;

  const isBack =
    key === "Escape" ||
    key === "Backspace" ||
    key === "GoBack" ||
    key === "BrowserBack" ||
    key === "Back";

  if(isBack){
    e.preventDefault();
    if(isGridOpen()) hideGrid();
    else closePlayer(true);
    return;
  }

  const isChanUp =
    key === "ChannelUp" || key === "TVChannelUp" ||
    key === "MediaTrackNext" || key === "MediaNextTrack" || key === "Next";

  const isChanDown =
    key === "ChannelDown" || key === "TVChannelDown" ||
    key === "MediaTrackPrevious" || key === "MediaPreviousTrack" || key === "Prev";

  if(isChanUp){ e.preventDefault(); nextChannel(); return; }
  if(isChanDown){ e.preventDefault(); prevChannel(); return; }

  // Enter: desbloquea audio en YouTube y/o muestra HUD
  if(key === "Enter"){
    e.preventDefault();

    // si hay foco en botón/tarjeta, clic
    const a = document.activeElement;
    if(a && typeof a.click === "function"){
      a.click();
      return;
    }

    // desbloqueo audio youtube (recarga con mute=0)
    unlockYoutubeAudioNow();

    $("player").classList.remove("hideHud");
    showHudAndArmTimer(true);
    return;
  }
}, true);

/* ============ DATA HELPERS ============ */

function findCategoryById(catId){
  return (CFG?.categories || []).find(c => c.id === catId) || null;
}

function buildPlaylistFromCategory(cat){
  // IMPORTANTE: solo youtube/hls van a la playlist (web no)
  const list = [];
  (cat?.items || []).forEach(item => {
    const type = normalizeType(item);
    if(type === "youtube" || type === "hls"){
      list.push({ ...item, type, category: cat.name || "" });
    }
  });
  return list;
}

/* ============ RENDER ============ */

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
      onClick: () => {
        setCatToUrl(c.id);
        renderByRoute();
      }
    }));
  });
}

function renderCategoryView(catId){
  const cat = findCategoryById(catId);

  const shortcutsBlock = $("shortcutsBlock");
  if(shortcutsBlock) shortcutsBlock.hidden = true;
  $("homeCategoriesBlock").hidden = true;

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

  PLAYLIST = buildPlaylistFromCategory(cat);

  (cat.items || []).forEach(item => {
    const type = normalizeType(item);

    grid.appendChild(makeCard({
      title: item.name,
      desc: item.desc || "",
      icon: item.icon,
      tag: (type === "web") ? "Web" : (type.toUpperCase()),
      onClick: () => {
        if(type === "web"){
          // web: dentro del player con HUD/back
          openPlayer();
          stopPlayers();
          const iframe = $("iframePlayer");
          iframe.allow = "autoplay; fullscreen; encrypted-media";
          iframe.src = item.url;
          iframe.style.display = "block";
          setNowPlaying(item.name || "Web");
          showHudAndArmTimer(true);
          return;
        }

        const idx = PLAYLIST.findIndex(x => x.url === item.url && x.name === item.name);
        if(idx >= 0) playChannelByIndex(idx);
      }
    }));
  });

  setTimeout(() => $("btnBackToHome")?.focus(), 80);
}

function renderHome(){
  const shortcutsBlock = $("shortcutsBlock");
  if(shortcutsBlock) shortcutsBlock.hidden = false;

  $("homeCategoriesBlock").hidden = false;
  $("categoryView").hidden = true;

  renderShortcuts();
  renderHomeCategories();

  setTimeout(() => {
    const first = document.querySelector("#shortcuts .card") || document.querySelector("#homeCategories .card");
    first?.focus();
  }, 80);
}

function renderByRoute(){
  const catId = getCatFromUrl();
  if(catId) renderCategoryView(catId);
  else renderHome();
}

/* Back a HOME en vista categoría */
$("btnBackToHome")?.addEventListener("click", () => {
  setCatToUrl("");
  renderByRoute();
});

/* Load config */
fetch("config/channels.json?v=10")
  .then(r => r.json())
  .then(cfg => {
    CFG = cfg;
    setBrand(cfg.brand);
    renderByRoute();
  })
  .catch(err => {
    console.error("Error cargando config/channels.json:", err);
    alert("No se pudo cargar config/channels.json. Revisá nombre/ruta y que sea JSON válido.");
  });
