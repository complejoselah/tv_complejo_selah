const $ = (id) => document.getElementById(id);

// ===== Ajuste dinámico: altura del header para que no pise "Volver" y el focus/scroll sea correcto =====
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
let hls = null;

let lastFocusMain = null;
let lastFocusGrid = null;
let pushedPlayerState = false;

let hudTimer = null;
let HUD_HIDE_MS = 6500;

// --- YouTube unlock ---
let ytSoundUnlocked = false;
let ytPendingVideoId = null;
let isCurrentYouTube = false;

function toAbsUrl(path){
  if(!path) return "";
  if(/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  return new URL(path, window.location.href).href;
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
  const qs = `autoplay=1&mute=${muted ? 1 : 0}&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1&enablejsapi=1`;
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
  setNowPlaying(`${ch.name || "Canal"} (${currentIndex+1}/${PLAYLIST.length})`);

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

  if(type === "hls"){
    const video = $("videoPlayer");
    video.style.display = "block";

    isCurrentYouTube = false;
    setSoundButtonState();

    if(video.canPlayType("application/vnd.apple.mpegurl")){
      video.src = ch.url;
      video.play().catch(()=>{});
      showHudAndArmTimer(false);
      setTimeout(() => $("btnBack")?.focus(), 120);
      return;
    }

    if(window.Hls && Hls.isSupported()){
      hls = new Hls();
      hls.loadSource(ch.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(()=>{});
        showHudAndArmTimer(false);
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

/* ========= CH UP / DOWN (control remoto) =========
   Android TV suele enviar keyCode 166/167 o e.key "ChannelUp"/"ChannelDown".
   También soportamos PageUp/PageDown por compatibilidad.
*/
function isChUp(e){
  const k = (e.key || "");
  const c = (e.code || "");
  const kc = e.keyCode || e.which || 0;
  return k === "ChannelUp" || k === "PageUp" || c === "ChannelUp" || kc === 166;
}
function isChDown(e){
  const k = (e.key || "");
  const c = (e.code || "");
  const kc = e.keyCode || e.which || 0;
  return k === "ChannelDown" || k === "PageDown" || c === "ChannelDown" || kc === 167;
}

/* Key handling TV */
document.addEventListener("keydown", (e) => {
  // ✅ Si está el player abierto, cualquier tecla re-muestra HUD (y rearma timer)
  if(isPlayerOpen() && !isGridOpen()) showHudAndArmTimer(false);

  // ✅ Volver desde vista categoría (cuando NO está el player)
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

  // Si no está el player, no interceptamos CH ▲/▼ (así no rompemos navegación del sistema)
  if(!isPlayerOpen()) return;

  // ✅ CH ▲/▼: cambiar canal SIEMPRE que el player esté abierto (y no esté la grilla encima)
  if(!isGridOpen() && (isChUp(e) || isChDown(e))){
    e.preventDefault();
    e.stopPropagation();
    showHudAndArmTimer(false);
    if(isChUp(e)) nextChannel();
    else prevChannel();
    return;
  }

  const key = e.key;
  const isBack =
    key === "Escape" || key === "Backspace" || key === "GoBack" ||
    key === "BrowserBack" || key === "Back";

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
    if(type === "youtube" || type === "hls"){
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
      onClick: () => { setCatToUrl(c.id); renderByRoute(); }
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

$("btnBackToHome")?.addEventListener("click", () => {
  setCatToUrl("");
  renderByRoute();
});

/* Load config */
fetch("config/channels.json?v=12")
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
