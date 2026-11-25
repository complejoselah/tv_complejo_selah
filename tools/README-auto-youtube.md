# Auto-actualización de canales de YouTube (Selah TV)

Resuelve el ID del **vivo actual** de cada canal de YouTube y lo escribe en
`config/channels.json`. Como las TVs leen ese archivo por GitHub Pages en cada
arranque, el cambio llega **solo**, sin recompilar el APK.

## Qué arregla
Los canales de YouTube se caían porque el ID del video en vivo cambia cuando la
emisora corta y reabre la transmisión. Ahora se refresca automáticamente.

## Dos formas de correrlo (elegir una)

### A) GitHub Actions (sin servidor) — recomendado para empezar
Ya está el workflow `.github/workflows/refresh-youtube-lives.yml`. Corre cada 15'
y, si cambió algo, commitea solo. Requiere que Actions tenga permiso de escritura
(Settings → Actions → General → Workflow permissions → "Read and write").
Nota: si YouTube llegara a bloquear las IPs de GitHub, usar la opción B.

### B) Cron en el servidor 24/7 (robusto)
En el server del edificio (energía solar, siempre online):

    */15 * * * * cd /ruta/al/repo && /usr/bin/python3 tools/refresh_youtube_lives.py >> /var/log/selah_yt.log 2>&1 \
      && git -C /ruta/al/repo add config/channels.json \
      && git -C /ruta/al/repo commit -m "auto: refrescar vivos YouTube" --quiet 2>/dev/null \
      && git -C /ruta/al/repo push --quiet

Para que el `push` funcione sin contraseña: agregar una **deploy key** de escritura
al repo (se genera una clave SSH en el server y se pega la pública en
Settings → Deploy keys → Add → Allow write access).

## Agregar un canal nuevo de YouTube
Editar el diccionario `YT_CHANNELS` en `tools/refresh_youtube_lives.py`:
poner el **nombre exacto** del canal (igual que en channels.json) y su **ID de canal**
(`UC...`) o su handle (`@nombre`). Nada más.

## Pendientes
- `LoFi Boy- Música` y `Alabanzas`: falta el ID de canal de YouTube propio.
  Completarlos en `YT_CHANNELS` y quedan auto-gestionados.
