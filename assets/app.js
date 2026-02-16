const $ = (id) => document.getElementById(id);

let CFG = null;
let currentIndex = -1;
let hls = null;

let lastFocusMain = null;
let lastFocusGrid = null;

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
}

function isPlayerOpen(){
  return $("player")?.classList.contains("show");
}
function isGridOpen(){
  return $("playerGrid") && !$("playerGrid").hidden;
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

function youtubeToEmbed(urlOrId){
  if(!urlOrId) return null;

  if(/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)){
    return `https://www.youtube-nocookie.com/embed/${urlOrId}?autoplay=1&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1`;
  }

  try{
    const u = new URL(urlOrId);

    if(u.hostname.includes("youtube.com") && u.pathname === "/watch"){
      const v = u.searchParams.get("v");
      if(v) return `https://www.youtube-nocookie.com/embed/${v}?autoplay=1&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1`;
    }

    if(u.hostname.includes("youtube.com") && u.pathname.startsWith("/live/")){
      const id = u.pathname.split("/live/")[1]?.split(/[?/]/)[0];
      if(id) return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1`;
    }

    if(u.hostname === "youtu.be"){
      const id = u.pathname.replace("/", "").split(/[?/]/)[0];
      if(id) return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&controls=0&rel=0&modestbranding=1&fs=1&playsinline=1`;
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
  v.pause();
  v.removeAttribute("src");
  v.load();
  v.style.display = "none";

  if(hls){
    hls.destroy();
    hls = null;
  }
}

function setNowPlaying(text){
  const el = $("nowPlaying");
  if(el) el.textContent = text || "";
}

/**
 * BACK robusto:
 * al abrir player hacemos pushState, y al volver (popstate) cerramos player.
 * Esto hace que el botón “volver” del control funcione aunque no llegue como keydown.
 */
let pushedPlayerState = false;

function pushPlayerState(){
  if(pushedPlayerState) return;
  try{
    history.pushState({ selahPlayer: true }, "");
    pushedPlayerState = true;
  }catch{}
}

function popPlayerStateIfNeeded(){
  if(!pushedPlayerState) return;
  pushedPlayerState = false;
  // Intentar “volver” el pushState
  try{ history.back(); }catch{}
}

window.addEventListener("popstate", () => {
  if(isPlayerOpen()){
    // si volvieron estando en player, cerrarlo (y no navegar fuera)
    closePlayer(false); // false: no hacer history.back de nuevo
  }
});

function openPlayer(){
  const player = $("player");
  player.classList.add("show");
  player.classList.remove("hideHud");
  player.setAttribute("aria-hidden", "false");

  // Evitar que iframe/video “robe” foco
  $("iframePlayer").tabIndex = -1;
  $("videoPlayer").tabIndex = -1;

  pushPlayerState();
  requestFullscreen(player);

  // Foco al botón Volver para que DPAD funcione
  setTimeout(() => $("btnBack")?.focus(), 80);
}

function closePlayer(popHistory = true){
  stopPlayers();
  $("player").classList.remove("show");
  $("player").setAttribute("aria-hidden", "true");
  hideGrid();
  exitFullscreenSafe();

  if(popHistory){
    // deja el historial “limpio” para que no acumule estados
    if(pushedPlayerState){
      pushedPlayerState = false;
      try{ history.back(); }catch{}
    }
  }else{
    pushedPlayerState = false;
  }

  setTimeout(() => (lastFocusMain || document.querySelector(".card"))?.focus(), 80);
}

function playChannelByIndex(idx){
  if(!CFG?.channels?.length) return;

  if(idx < 0) idx = CFG.channels.length - 1;
  if(idx >= CFG.channels.length) idx = 0;
  currentIndex = idx;

  const ch = CFG.channels[currentIndex];
  setNowPlaying(`${ch.name || "Canal"}  (${currentIndex+1}/${CFG.channels.length})`);

  stopPlayers();
  openPlayer();

  const type = ch.type || (String(ch.url || "").includes(".m3u8") ? "hls" : "youtube");

  if(type === "youtube"){
    const embed = youtubeToEmbed(ch.url);
    if(!embed){
      window.open(ch.url, "_blank", "noopener");
      return;
    }
    $("iframePlayer").src = embed;
    $("iframePlayer").style.display = "block";
    // mantener foco en HUD, no en iframe
    setTimeout(() => $("btnBack")?.focus(), 120);
    return;
  }

  if(type === "hls"){
    const url = ch.url;
    const video = $("videoPlayer");
    video.style.display = "block";

    if(video.canPlayType("application/vnd.apple.mpegurl")){
      video.src = url;
      video.play().catch(()=>{});
      setTimeout(() => $("btnBack")?.focus(), 120);
      return;
    }

    if(window.Hls && Hls.isSupported()){
      hls = new Hls({ lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(()=>{});
        setTimeout(() => $("btnBack")?.focus(), 120);
      });
      return;
    }

    alert("Este dispositivo/navegador no soporta HLS (.m3u8).");
  }
}

function nextChannel(){ playChannelByIndex(currentIndex + 1); }
function prevChannel(){ playChannelByIndex(currentIndex - 1); }

function toggleHud(){
  $("player").classList.toggle("hideHud");
  // si muestran HUD, devolver foco al botón volver
  if(!$("player").classList.contains("hideHud")){
    setTimeout(() => $("btnBack")?.focus(), 50);
  }
}

function showGrid(){
  $("playerGrid").hidden = false;

  const grid = $("gridInsidePlayer");
  grid.innerHTML = "";

  (CFG.channels || []).forEach((ch, i) => {
    grid.appendChild(makeCard({
      title: ch.name,
      desc: "",
      icon: ch.icon,
      tag: ch.tag,
      onClick: () => {
        hideGrid();
        playChannelByIndex(i);
      }
    }));
  });

  setTimeout(() => {
    (grid.querySelector(".card") || $("btnCloseGrid"))?.focus();
  }, 80);
}

function hideGrid(){
  if($("playerGrid")) $("playerGrid").hidden = true;
  setTimeout(() => $("btnBack")?.focus(), 50);
}

/* Botones HUD */
$("btnBack")?.addEventListener("click", () => closePlayer(true));
$("btnNext")?.addEventListener("click", nextChannel);
$("btnPrev")?.addEventListener("click", prevChannel);
$("btnGrid")?.addEventListener("click", showGrid);
$("btnCloseGrid")?.addEventListener("click", hideGrid);

/**
 * KEY HANDLING (TV):
 * - Flechas (Arrow*) NUNCA cambian canal (se dejan para navegación de foco).
 * - NO usamos PageUp/PageDown porque en tu control se comportan como flechas.
 * - Cambiar canal: ChannelUp/Down o variantes MediaNext/Prev (si llegan).
 * - Back/Escape/Backspace: cierra grilla o cierra player.
 */
document.addEventListener("keydown", (e) => {
  if(!isPlayerOpen()) return;

  const key = e.key;

  // Back
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

  // Cambiar canal SOLO con teclas “canal/track” (no PageUp/PageDown, no flechas)
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

  // Enter/OK: activar foco (click) o toggle HUD si no hay elemento clickeable
  if(key === "Enter"){
    const a = document.activeElement;
    if(a && typeof a.click === "function"){
      e.preventDefault();
      a.click();
      return;
    }
    e.preventDefault();
    toggleHud();
    return;
  }

  // Flechas: NO interceptar -> navegación nativa por foco
}, true); // capture=true ayuda a capturar antes que otros handlers

/* Cargar config */
fetch("config/channels.json?v=1")
  .then(r => r.json())
  .then(cfg => {
    CFG = cfg;
    setBrand(cfg.brand);

    const shortcutsEl = $("shortcuts");
    if(shortcutsEl){
      (cfg.shortcuts || []).forEach(s => {
        shortcutsEl.appendChild(makeCard({
          title: s.name,
          desc: s.desc,
          icon: s.icon,
          tag: "Acceso",
          onClick: () => window.open(s.url, "_blank", "noopener")
        }));
      });
    }

    const channelsEl = $("channels");
    (cfg.channels || []).forEach((ch, i) => {
      channelsEl.appendChild(makeCard({
        title: ch.name,
        desc: "",
        icon: ch.icon,
        tag: ch.tag,
        onClick: () => playChannelByIndex(i)
      }));
    });

    setTimeout(() => {
      const first = document.querySelector(".card");
      if(first) first.focus();
    }, 80);
  })
  .catch(err => {
    console.error("Error cargando config/channels.json:", err);
    alert("No se pudo cargar config/channels.json. Revisá nombre/ruta y que sea JSON válido.");
  });
