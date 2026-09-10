# AR Navigate — Byggnadsnavigering

Webbapp för inomhusnavigering med planritning, waypoints, ruttberäkning och AR-läge.

## Vad som ingår
- Editor för planritning och navigeringspunkter.
- Ruttberäkning med alternativ för snabbaste, tillgänglig, trappor eller hiss.
- Sökning efter destination.
- Kalibrering av planritningens skala med två punkter + verkligt avstånd.
- WebXR/ARCore-läge med olivgröna pilar på golvet när enheten stöder `immersive-ar`.
- Reservläge med kamerabild/simulerad vy när WebXR inte stöds.
- LocalStorage-fallback så projektet kan testas utan backend.
- PWA-manifest och service worker.

## GitHub Pages
1. Lägg filerna i repositoryts rot.
2. Kontrollera att `index.html` ligger i roten.
3. Gå till **Settings → Pages**.
4. Välj **Deploy from a branch**, branch `main`, folder `/ (root)`.
5. Öppna den publicerade HTTPS-adressen på en telefon.

GitHub Pages kör inte den ursprungliga backend-servern. Den här versionen använder LocalStorage när API:t inte är tillgängligt.

## AR
WebXR kräver normalt HTTPS på en fysisk enhet. På Android fungerar AR-delen bara om webbläsaren/enheten stöder WebXR `immersive-ar` och nödvändiga ARCore-funktioner.

AR-läget känner inte automatiskt igen exakt var i en byggnad användaren befinner sig. För exakt inomhuspositionering behövs senare exempelvis BLE/UWB/Wi‑Fi eller annan lokaliseringskälla.
