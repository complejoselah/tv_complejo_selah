# Revisión de Selah TV

El archivo recibido contiene un portal HTML/CSS/JavaScript y un proxy PHP. No contiene Gradle, AndroidManifest.xml, fuentes Kotlin independientes ni APK. El único MainActivity está transcripto en README.txt, líneas 22–83. Usa WebView; no hay Compose ni RecyclerView en el material disponible. Las líneas de los hallazgos siguientes corresponden al ZIP original.

## Hallazgos y correcciones entregadas

1. **D-pad sin navegación explícita**: assets/app.js:564–615 procesa Back y Enter, pero no las cuatro flechas. index.html:52 y 100 expone directamente inputs de búsqueda editables. El paso por un input depende de la navegación espacial y del teclado de cada WebView; el código permite que el foco llegue al campo editable durante el recorrido. Es una causa compatible con el síntoma, pendiente de reproducir en el TV afectado. Se agrega assets/tv-navigation.js antes de app.js: navegación geométrica dentro de la vista activa, aislamiento de la grilla del reproductor y buscadores de solo lectura durante el recorrido por flechas. OK habilita edición; Enter o Escape finaliza; el puntero permite edición directa. No se identifica TV usando solamente hover:none, para no bloquear teléfonos.

2. **Buscadores usan la primera categoría/serie**: assets/app.js:1123–1129 y 1280–1286 instala una sola vez un listener que captura catId/items. Al cambiar de categoría o serie se sigue filtrando el catálogo anterior. Se reemplazan esos listeners por oninput reasignado en cada vista. Las pruebas simulan dos aperturas y verifican que se filtre la segunda colección.

3. **Enter puede reproducir dos veces**: assets/app.js:598–603 ejecuta click en captura; assets/app.js:178–183 vuelve a ejecutar onClick en la tarjeta. preventDefault no detiene la propagación. Se detiene el evento al activar en captura y se ignoran repeticiones de Enter allí.

4. **Backspace interfiere con edición**: assets/app.js:568–585 trata Backspace como navegación incluso al escribir. Se omiten atajos globales sobre campos editables. El listener de detalle (925–930) ahora respeta eventos ya consumidos y no actúa sobre reproductor o campos de texto.

5. **hidden y display explícito**: assets/style.css:387, 563 y 647 define display:flex para barras que index.html y app.js intentan ocultar con hidden. Se agrega [hidden]{display:none!important} para que filtros y vistas ocultas no participen del recorrido.

6. **Salto de tamaño al enfocar**: assets/style.css:148–152 cambia borde de 1 a 3 píxeles y escala la tarjeta. Se conserva el borde y se dibuja un contorno exterior. Con navegación por flechas se desactiva content-visibility:auto de las tarjetas para que la geometría de búsqueda sea estable; esto puede aumentar el trabajo de layout en catálogos muy grandes.

7. **Carga de imágenes y fallback**: assets/app.js:154 carga todas las imágenes sin lazy loading; 164–167 registra error con addEventListener pero intenta anularlo con img.onerror=null. Si también falla el fallback puede reiterarse el error. Se usa loading=lazy, decoding=async, listener de una ejecución y assets/Selah.png, que existe en el ZIP.

8. **Inicio superpuesto al detalle**: assets/app.js:688–702 muestra inicio sin ocultar detailView. renderHome ahora oculta primero todas las vistas.

## Aspectos pendientes de integración y mejoras propuestas

- El MainActivity del README:73–81 maneja Back con historial WebView antes de delegarlo al portal. Eso puede cerrar el reproductor al intentar cerrar solo la grilla, o salir de una vista de detalle que no tiene ruta propia. Hace falta el proyecto Android real para integrar y comprobar un contrato de Back entre Android y JavaScript. No se entrega una APK ni se modifica ese ejemplo como si fuera la fuente instalada.
- README.txt:55 usa WebChromeClient sin implementación de onCreateWindow ni onShowCustomView. app.js:646 y 921 usa window.open para accesos/tráilers; su apertura y el fullscreen requieren comprobarse con el contenedor real. Los iframes externos tampoco permiten al portal controlar su foco interno si pertenecen a otro origen.
- assets/app.js:947 evita toda caché de configuración y prueba rutas inexistentes antes de config/channels.json. Se conservó por compatibilidad con instalaciones que usan archivos enriquecidos; conviene definir una ruta principal, validación HTTP y timeout/reintento con mensaje visible.
- assets/app.js:153–160 interpola títulos, descripciones y URL en innerHTML. Si el catálogo no es completamente confiable, conviene usar textContent y atributos DOM con validación de protocolos. No cargar catálogos de terceros sin revisión.
- assets/img.php:21–26 permite HTTP/HTTPS arbitrario y redirecciones. Si se publica, puede usarse como proxy hacia servicios internos. Requiere lista de hosts exactos permitidos, validación de cada redirección y límites de tamaño; no se impuso una lista inventada que pudiera romper imágenes existentes.
- Volver desde reproductor puede reconstruir la categoría por popstate (app.js:292–298), perdiendo filtro y foco anterior; conviene almacenar estado por ruta e identificador estable de tarjeta. No se reestructuró el historial en este parche.
- Se conserva el catálogo, los medios, los filtros y los reproductores originales. No se afirma haber verificado disponibilidad de streams externos ni compatibilidad de cada proveedor.

## Validación realizada

- node --check: app.js y tv-navigation.js, sin errores.
- Diez aserciones simuladas: bajar desde Volver al buscador, pasar a tarjeta, subir, activar edición, mantener flechas en edición, cancelar, volver a grilla, editar con puntero y cambiar la colección de búsqueda de categoría y episodios. Son pruebas con DOM simulado; no sustituyen ejecución en navegador/WebView.
- No se ejecutó Android Studio, compilación APK, emulador, teclado Android ni reproducción real. No se evaluaron tiempos de cuadros ni memoria del TV.

## Instalación y prueba en TV

1. Guardar copia del portal actualmente publicado y desplegar el contenido de esta carpeta en la misma URL que usa la APK. La corrección es del portal; no requiere por sí misma cambiar URL ni firmar una APK nueva. No se realizó despliegue desde esta revisión.
2. Recargar completamente el portal; index.html usa versión 18 para los recursos modificados.
3. Con el control: abrir categoría, bajar desde Volver al buscador, bajar a la grilla, recorrer filas, volver al buscador, pulsar OK y escribir. Finalizar edición con Enter o Escape cuando el dispositivo los envíe al portal. El cierre del teclado mediante Back físico depende del contenedor Android.
4. Cambiar de categoría y de serie; buscar títulos diferentes y comprobar que no aparezcan elementos del catálogo anterior.
5. Probar reproducción, siguiente/anterior, grilla interna y un único inicio de reproducción por OK; regresar a detalle/inicio. Probar además teléfono, filtros select, resultados vacíos, accesos y tráiler.
6. Registrar modelo del TV, versión Android, versión Android System WebView y pasos si el teclado sigue abriéndose. Para cerrar la revisión nativa, aportar el proyecto Android usado para compilar la APK.

Referencias: https://developer.android.com/training/tv/get-started/navigation y https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/readonly . El campo readonly sigue siendo enfocable; la apertura efectiva del IME requiere validación en el dispositivo.
