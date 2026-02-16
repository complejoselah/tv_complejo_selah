Selah TV Portal (liviano)

Prueba local (Mac + XAMPP)
- Copiá la carpeta a: /Applications/XAMPP/htdocs/selah_portal_tv/
- Abrí: http://localhost/selah_portal_tv/

Imágenes / branding
- Copiá tus logos e imágenes desde:
  /Users/andreaveronicazurita/Desktop/backup_pendrive/Escritorio/Shared/imagen usuario/Selah
- Colocalas dentro de assets/ con estos nombres (recomendado):
  selah_logo.png, bg.jpg, jellyfin.png, tn.png, c5n.png, a24.png, c26.png, lofi.png

Config
- Editá config/channels.json para:
  - poner la IP real de Jellyfin
  - agregar/quitar canales



-Teniendo en cuenta que el mainActivity.kt actual es: 

package com.selah.tv

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity

class MainActivity : ComponentActivity() {

  private lateinit var web: WebView

  // Cambiá esta URL a tu server (LAN o tailscale)
  private val START_URL = "http://100.68.220.67/selah_portal_tv/"

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    web = WebView(this)
    setContentView(web)

    // Fullscreen inmersivo
    window.decorView.systemUiVisibility =
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
      View.SYSTEM_UI_FLAG_FULLSCREEN or
      View.SYSTEM_UI_FLAG_HIDE_NAVIGATION

    web.webViewClient = WebViewClient()
    web.webChromeClient = WebChromeClient()

    val s = web.settings
    s.javaScriptEnabled = true
    s.domStorageEnabled = true
    s.mediaPlaybackRequiresUserGesture = false
    s.cacheMode = WebSettings.LOAD_DEFAULT
    s.useWideViewPort = true
    s.loadWithOverviewMode = true

    // Mejora para TV
    web.isFocusable = true
    web.isFocusableInTouchMode = true
    web.requestFocus()

    web.loadUrl(START_URL)
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    // BACK físico: volver dentro de la web si se puede
    if (keyCode == KeyEvent.KEYCODE_BACK) {
      if (web.canGoBack()) {
        web.goBack()
        return true
      }
    }
    return super.onKeyDown(keyCode, event)
  }
}
 
-Y aun resta Activity con leanback_launcher en el MainActivity:

<activity
  android:name=".MainActivity"
  android:exported="true">

  <intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
  </intent-filter>

  <!-- opcional: para que también aparezca en teléfono -->
  <intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
  </intent-filter>

</activity>
-tambien faltan los siguientes pasos que me recomendaste que son: 

3) URL del portal (strings.xml)

Editá:

nano ~/selah-tv/app/src/main/res/values/strings.xml


Dejá algo así:

<resources>
  <string name="app_name">Selah TV</string>
  <string name="portal_url">http://100.68.220.67/selah_portal_tv/</string>
</resources>


Si tu MainActivity.kt aún no usa portal_url, decime qué hace y te lo adapto en 2 líneas.

4) Compilar APK release desde terminal (sin Android Studio)

Desde la raíz del proyecto:

cd ~/selah-tv
./gradlew clean
./gradlew assembleRelease


Tu APK queda en:

~/selah-tv/app/build/outputs/apk/release/app-release.apk

5) Firmar profesional (keystore) desde terminal
5.1 Crear keystore (una sola vez)
keytool -genkeypair -v \
  -keystore ~/selah-tv/selah.keystore \
  -alias selah \
  -keyalg RSA -keysize 2048 -validity 10000

5.2 Firmar con apksigner

Build-tools:

BT="$HOME/Library/Android/sdk/build-tools/34.0.0"
APK=~/selah-tv/app/build/outputs/apk/release/app-release.apk
OUT=~/selah-tv/app/build/outputs/apk/release/SelahTV-signed.apk

"$BT/apksigner" sign \
  --ks ~/selah-tv/selah.keystore \
  --ks-key-alias selah \
  --out "$OUT" \
  "$APK"

"$BT/apksigner" verify --verbose "$OUT"

6) Instalación en TV/onn (Drive o ADB)
Drive (simple)

Subís SelahTV-signed.apk a Drive

Bajás en la TV/onn

Instalás con un File Manager

ADB (si lo habilitás)
adb connect IP_TV:5555
adb install -r ~/selah-tv/app/build/outputs/apk/release/SelahTV-signed.apk

7) Checklist rápido (si “no aparece” en el launcher)

El <intent-filter> tiene LEANBACK_LAUNCHER

android:banner="@drawable/tv_banner"

android:exported="true" en la activity

Instalaste el APK firmado (no el unsigned)

-Dame los pasos a seguir para instalar correctamente el leanback_Launcher en MainActivity y continuar con los pasos para continuar con el proyecto y cargar el app en el drive para su posterior instalacion en los non tv y androides.
