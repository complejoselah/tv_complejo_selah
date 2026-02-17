
const $ = (id) => document.getElementById(id);

let CFG = null;

// playlist = items reproducibles de la CATEGORÍA actual (youtube/hls)
let PLAYLIST = [];
let currentIndex = -1;
let hls = null;

let lastFocusMain = null;
let lastFocusGrid = null;

let pushedPlayerState = false;

// HUD auto-hide
let hudTimer = null;
let HUD_HIDE_MS = 6500;

// --- YouTube audio unlock state ---
let YT_SOUND_URL = null;     // embed con mute=0 del canal actual
let ytIsMuted = false;       // si el iframe actual está muteado
let ytSoundUnlocked = false; // si el usuario ya hizo una interacción que permite audio

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

/**
 * YouTube embed:
 * - muted=true para permitir autoplay en Android/Chrome
 * - muted=false solo debe usarse luego de una interacción del usuario
 */
function youtubeToEmbed(urlOrId, muted=true){
  if(!urlOrId) return null;

  // nota: playsinline=1 + autoplay=1
  // mute se controla acá
  const qs = `autoplay=1&${muted ? "mute=1" : "mute=0"}&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1`;

  if(/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)){
    return `https://www.youtube-nocookie.com/embed/${urlOrId}?${qs}`;
  }

  try{
    const u = new URL(urlOrId);

    if(u.hostname.includes("youtube.com") && u.pathname === "/watch"){
      const v = u.searchParams.get("v");
      if(v) return `https://www.youtube-nocookie.com/embed/${v}?${qs}`;
    }

    if(u.hostname.includes("youtube.com") && u.pathname.startsWith("/live/")){
      const id = u.pathname.split("/live/")[1]?.split(/[?/]/)[0];
      if(id) return `https://www.youtube-nocookie.com/embed/${id}?${qs}`;
    }

    if(u.hostname === "youtu.be"){
      const id = u.pathname.replace("/", "").split(/[?/]/)[0];
      if(id) return `https://www.youtube-nocookie.com/embed/${id}?${qs}`;
    }

    return null;
  }catch{
    return null;
  }
}

async function requestFullscreen(el){
  try{
    if(el.requestFullscreen) await el.requestFullscreen();
    else if(el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  }catch(e){}
}

function exitFullscreenSafe(){
  try{
    if(document.fullscreenElement) document.exitFullscreen();
    else if(document.webkitFullscreenElement) document.webkitExitFullscreen();
  }catch{}
}

function stopPlayers(){
  const iframe = $("iframePlayer");
  iframe.src = "";
  iframe.style.display = "none";

  const v = $("videoPlayer");
  try{ v.pause(); }catch{}
  v.removeAttribute("src");
  v.load();
  v.style.display = "none";

  if(hls){
    try{ hls.destroy(); }catch{}
    hls = null;
  }

  // reset YT state por canal
  YT_SOUND_URL = null;
  ytIsMuted = false;
}

function setNowPlaying(text){
  const el = $("nowPlaying");
  if(el) el.textContent = text || "";
}

/* HUD autohide */
function showHudAndArmTimer(){
  const player = $("player");
  if(!player) return;

  player.classList.remove("hideHud");

  if(hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    if(isPlayerOpen() && !isGridOpen()){
      player.classList.add("hideHud");
    }
  }, HUD_HIDE_MS);
}

/**
 * Intenta "desmutear" YouTube recargando el iframe con mute=0.
 * Solo funciona confiable si viene inmediatamente después de una interacción del usuario.
 */
function tryUnlockYoutubeAudio(){
  if(!isPlayerOpen() || isGridOpen()) return false;

  const iframe = $("iframePlayer");
  if(!iframe || iframe.style.display !== "block") return false;

  if(!YT_SOUND_URL || !ytIsMuted) return false;

  // marcamos como "hubo interacción"
  ytSoundUnlocked = true;

  // recarga con sonido
  iframe.src = YT_SOUND_URL;
  ytIsMuted = false;
  YT_SOUND_URL = null;

  // para que el overlay no quede “tapando” controles cuando reaparece HUD (CSS lo maneja)
  showHudAndArmTimer();
  return true;
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

  showHudAndArmTimer();
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

function normalizeType(item){
  const t = (item.type || "").toLowerCase();
  if(t) return t;
  const u = String(item.url || "");
  if(u.includes(".m3u8")) return "hls";
  if(/youtube\.com|youtu\.be/i.test(u) || /^[a-zA-Z0-9_-]{11}$/.test(u)) return "youtube";
  return "web";
}

/* PLAY */
function playChannelByIndex(idx){
  if(!PLAYLIST.length) return;

  if(idx < 0) idx = PLAYLIST.length - 1;
  if(idx >= PLAYLIST.length) idx = 0;
  currentIndex = idx;

  const ch = PLAYLIST[currentIndex];
  setNowPlaying(`${ch.name || "Canal"}  (${currentIndex+1}/${PLAYLIST.length})`);

  stopPlayers();

  const type = normalizeType(ch);

  // =========================
  // WEB / EMBED (Pluto, Plex, etc)
  // =========================
  if(type === "web"){
    openPlayer();

    const iframe = $("iframePlayer");
    iframe.src = ch.url;
    iframe.style.display = "block";

    showHudAndArmTimer();
    setTimeout(() => $("btnBack")?.focus(), 120);
    return;
  }

  openPlayer();

  // =========================
  // YOUTUBE
  // =========================
  if(type === "youtube"){
    const iframe = $("iframePlayer");

    const embedMuted = youtubeToEmbed(ch.url, true);
    const embedSound = youtubeToEmbed(ch.url, false);

    if(!embedMuted || !embedSound){
      iframe.src = ch.url;
      iframe.style.display = "block";
      return;
    }

    const firstUrl = ytSoundUnlocked ? embedSound : embedMuted;

    iframe.src = firstUrl;
    iframe.style.display = "block";

    YT_SOUND_URL = embedSound;
    ytIsMuted = !ytSoundUnlocked;

    showHudAndArmTimer();
    setTimeout(() => $("btnBack")?.focus(), 120);
    return;
  }

  // =========================
  // HLS (.m3u8)
  // =========================
  if(type === "hls"){
    const url = ch.url;
    const video = $("videoPlayer");
    video.style.display = "block";

    if(video.canPlayType("application/vnd.apple.mpegurl")){
      video.src = url;
      video.play().catch(()=>{});
      showHudAndArmTimer();
      setTimeout(() => $("btnBack")?.focus(), 120);
      return;
    }

    if(window.Hls && Hls.isSupported()){
      hls = new Hls({ lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(()=>{});
        showHudAndArmTimer();
        setTimeout(() => $("btnBack")?.focus(), 120);
      });
      return;
    }

    alert("Este dispositivo/navegador no soporta HLS (.m3u8).");
    closePlayer(true);
  }
}


function nextChannel(){ playChannelByIndex(currentIndex + 1); }
function prevChannel(){ playChannelByIndex(currentIndex - 1); }

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

  showHudAndArmTimer();
  setTimeout(() => (grid.querySelector(".card") || $("btnCloseGrid"))?.focus(), 80);
}

function hideGrid(){
  if($("playerGrid")) $("playerGrid").hidden = true;

  showHudAndArmTimer();
  setTimeout(() => $("btnBack")?.focus(), 50);
}

/* HUD botones */
$("btnBack")?.addEventListener("click", () => closePlayer(true));
$("btnNext")?.addEventListener("click", () => { showHudAndArmTimer(); nextChannel(); });
$("btnPrev")?.addEventListener("click", () => { showHudAndArmTimer(); prevChannel(); });
$("btnGrid")?.addEventListener("click", () => { showHudAndArmTimer(); showGrid(); });
$("btnCloseGrid")?.addEventListener("click", () => { showHudAndArmTimer(); hideGrid(); });

/**
 * Overlay click/touch:
 * - siempre re-muestra HUD
 * - y además intenta ACTIVAR AUDIO de YouTube (recargando con mute=0)
 */
$("playerTap")?.addEventListener("pointerdown", (e) => {
  if(!isPlayerOpen()) return;
  e.preventDefault();

  // IMPORTANTE: esto es una interacción del usuario -> momento ideal para habilitar audio
  // Primero intentamos desbloquear audio, luego mostramos HUD
  tryUnlockYoutubeAudio();
  showHudAndArmTimer();
}, { passive:false });

/* Back a HOME en vista categoría */
$("btnBackToHome")?.addEventListener("click", () => {
  setCatToUrl("");
  renderByRoute();
});

/* Reaparecer HUD ante interacción (HLS/PC/teléfono) */
["pointermove","wheel"].forEach(ev => {
  document.addEventListener(ev, () => {
    if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer();
  }, { passive:true });
});

// Para video nativo / HLS (el iframe puede no propagar)
document.addEventListener("pointerdown", () => {
  if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer();
}, { passive:true });

/* Key handling TV */
document.addEventListener("keydown", (e) => {
  if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer();

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

  if(isChanUp){
    e.preventDefault();
    nextChannel();
    return;
  }
  if(isChanDown){
    e.preventDefault();
    prevChannel();
    return;
  }

  // Enter/OK:
  // - si hay iframe YouTube muteado, lo usamos como “Activar audio”
  // - si no, alterna HUD
  if(key === "Enter"){
    const a = document.activeElement;
    if(a && typeof a.click === "function"){
      e.preventDefault();
      a.click();
      return;
    }

    e.preventDefault();

    // Intentar activar audio YouTube primero
    const unlocked = tryUnlockYoutubeAudio();
    if(unlocked){
      showHudAndArmTimer();
      return;
    }

    $("player").classList.toggle("hideHud");
    if(!$("player").classList.contains("hideHud")) showHudAndArmTimer();
    return;
  }
}, true);

/* Helpers de datos */
function findCategoryById(catId){
  return (CFG?.categories || []).find(c => c.id === catId) || null;
}

function buildPlaylistFromCategory(cat){
  const list = [];
  (cat?.items || []).forEach(item => {
    const type = normalizeType(item);
    if(type === "youtube" || type === "hls"){
      list.push({ ...item, type, category: cat.name || "" });
    }
  });
  return list;
}

/* Render */
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
          window.open(item.url, "_blank", "noopener");
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

/* Load config */
fetch("config/channels.json?v=5")
  .then(r => r.json())
  .then(cfg => {
    CFG = cfg;
    setBrand(cfg.brand);

    renderShortcuts();
    renderByRoute();
  })
  .catch(err => {
    console.error("Error cargando config/channels.json:", err);
    alert("No se pudo cargar config/channels.json. Revisá nombre/ruta y que sea JSON válido.");
  });
