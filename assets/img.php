<?php
// img.php — proxy simple para imágenes remotas (evita ORB / hotlink / 403)
// Uso: /img.php?url=https%3A%2F%2Fejemplo.com%2Fimagen.jpg

declare(strict_types=1);

$url = $_GET['url'] ?? '';
if (!$url) { http_response_code(400); exit('missing url'); }

$url = trim($url);

// Solo http/https
if (!preg_match('#^https?://#i', $url)) { http_response_code(400); exit('bad url'); }

// (Opcional) lista blanca de dominios para mayor seguridad
// $allow = ['pluto.tv','archive.org','kaltura.com','vodgc.net'];
// $host = parse_url($url, PHP_URL_HOST) ?: '';
// $ok = false; foreach($allow as $d){ if(str_ends_with($host, $d)){ $ok=true; break; } }
// if(!$ok){ http_response_code(403); exit('domain not allowed'); }

$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_MAXREDIRS => 5,
  CURLOPT_CONNECTTIMEOUT => 6,
  CURLOPT_TIMEOUT => 12,
  CURLOPT_USERAGENT => 'Mozilla/5.0 (SelahTV Image Proxy)',
  CURLOPT_HTTPHEADER => [
    'Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer: ' . ($_SERVER['HTTP_HOST'] ?? 'localhost'),
  ],
]);

$data = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$ct   = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: '';
$err  = curl_error($ch);
curl_close($ch);

if ($data === false || $code >= 400) {
  http_response_code(502);
  header('Content-Type: text/plain; charset=utf-8');
  exit("proxy error ($code): $err");
}

// Si no parece imagen, cortamos (evita que te devuelvan HTML y el navegador bloquee)
if (!preg_match('#^image/#i', $ct)) {
  http_response_code(415);
  header('Content-Type: text/plain; charset=utf-8');
  exit("not an image: $ct");
}

header('Content-Type: ' . $ct);
header('Cache-Control: public, max-age=86400'); // 1 día
echo $data;