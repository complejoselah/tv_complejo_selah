#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Selah TV - Auto-actualizador de canales de YouTube en vivo.

Para cada canal de YouTube de config/channels.json, busca el ID del VIVO
ACTUAL del canal (que cambia cuando la emisora corta y reabre la transmision)
y lo reescribe. Solo reemplaza cuando encuentra un vivo VERIFICADO; si el canal
esta fuera de aire, deja el ID que estaba. No toca el resto del catalogo.

Uso:
    python3 tools/refresh_youtube_lives.py           # actualiza y reporta
    python3 tools/refresh_youtube_lives.py --check   # solo reporta, no escribe

Salida: codigo 0 siempre; imprime un reporte. Si cambio algo, deja
config/channels.json modificado (el commit/push lo hace el workflow o el cron).
"""
import re, sys, json, time, pathlib, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHANNELS = ROOT / "config" / "channels.json"

# Nombre EXACTO del canal en channels.json  ->  canal de YouTube (UCID o @handle).
# Agregar aca un canal nuevo basta para que entre al auto-refresh.
YT_CHANNELS = {
    "C5N - En vivo":                 "UCFgk2Q2mVO1BklRQhSv6p0w",
    "LN+ - En vivo":                 "UCba3hpU7EFBSk817y9qZkiA",
    "AR 12 - En vivo":               "UC1bBjOZieJWHbsFA0LwjjJA",
    "Cronica - En vivo":             "UCT7KFGv6s2a-rh2Jq8ZdM1g",
    "TV Pública - En vivo":          "UCs231K71Bnu5295_x0MB5Pg",
    "DW Español - En vivo":          "UCT4Jg8h03dD0iN3Pb5L0PMA",
    "France 24 Español - En vivo":   "UCUdOoVWuWmgo1wByzcsyKDQ",
    "Euronews Español - En vivo":    "UCyoGb3SMlTlB8CLGVH4c8Rw",
    "NASA (YouTube oficial)":        "@NASA",
    "Africa en Vivo":                "UCuoNAKa3P0QR1Lw9QdpmoVg",
    "LoFi Girl - Música":            "UCSJ4gkVC6NrvII8umztf0Ow",
    "Chill out Music":               "UCrqFwXyCre0_dm7MvMWL9Dg",
    "The Global Prayer Room (Live)": "UCqSYig9Cmx6DJ3XaUYg4vpw",
    "La Biblia en Canción (Live)":   "UCNX36aGB2nh79NNAk6vMcUA",
    # "LoFi Boy- Música": "UC...",   # <- completar canal propio si se desea
    # "Alabanzas":        "UC...",   # <- completar canal propio si se desea
}

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept-Language": "es-AR,es"}
VID_RE  = re.compile(r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})">')

def _get(url, tries=3, timeout=14):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
        except Exception as e:
            last = e; time.sleep(2)
    raise last

def current_live_id(resolver):
    """Devuelve el video-id del vivo actual del canal, o None si no esta en vivo."""
    base = (f"https://www.youtube.com/channel/{resolver}/live"
            if resolver.startswith("UC")
            else f"https://www.youtube.com/{resolver}/live")
    html = _get(base)
    m = VID_RE.search(html)
    if not m:
        return None
    vid = m.group(1)
    # Verificar que ese ID sea realmente un vivo (no un VOD que quedo de canonical)
    watch = _get("https://www.youtube.com/watch?v=" + vid)
    if '"isLive":true' in watch or 'hlsManifestUrl' in watch:
        return vid
    return None

def main():
    check_only = "--check" in sys.argv
    data = json.loads(CHANNELS.read_text(encoding="utf-8"))
    # cache por canal para no pegarle dos veces si aparece en varias categorias
    resolved = {}
    changes, kept, offline, errors = [], [], [], []
    for cat in data.get("categories", []):
        for item in (cat.get("items") or []):
            if not isinstance(item, dict) or item.get("type") != "youtube":
                continue
            name = item.get("name", "")
            resolver = YT_CHANNELS.get(name)
            if not resolver:
                continue
            if resolver not in resolved:
                try:
                    resolved[resolver] = ("ok", current_live_id(resolver))
                except Exception as e:
                    resolved[resolver] = ("err", f"{type(e).__name__}")
            status, val = resolved[resolver]
            if status == "err":
                errors.append(f"{name}: {val}")
                continue
            new = val
            old = str(item.get("url", ""))
            if new is None:
                offline.append(name)            # fuera de aire: se deja el ID actual
            elif new != old:
                if not check_only:
                    item["url"] = new
                changes.append(f"{name}: {old} -> {new}")
            else:
                kept.append(name)

    if changes and not check_only:
        CHANNELS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] refresh YouTube lives")
    print(f"  cambios:    {len(changes)}")
    for c in changes: print("    +", c)
    print(f"  sin cambio: {len(kept)}")
    if offline: print(f"  fuera de aire (se dejo el ID previo): {', '.join(offline)}")
    if errors:  print(f"  errores:    {', '.join(errors)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
