# Cinemate — logo & app icons

Set complet de icoane pentru web/PWA, generat din sursa SVG. Pune `icons/` si
`site.webmanifest` in `public/` (radacina servita de Cloudflare Pages).

## Structura
- `svg/icon.svg` — sursa master, patrat full-bleed (gradient + inima cu play decupat)
- `svg/favicon.svg` — varianta cu colturi rotunjite (favicon SVG modern)
- `svg/icon-mono.svg` — o singura culoare, `fill="currentColor"` (mosteneste color din CSS)
- `svg/lockup.svg` — icon + wordmark pe fundal dark (README / social / header)
- `icons/` — PNG-uri rasterizate (vezi mai jos)
- `og-image.png` — 1200x630, pentru share pe social (Open Graph / Twitter)
- `logo-lockup.png` — lockup orizontal pe fundal transparent (headere)

## Icoane raster (`icons/`)
| fisier | dimensiune | rol |
|---|---|---|
| favicon.ico | 16/32/48 | favicon clasic |
| favicon-16.png / -32.png / -48.png | 16–48 | favicon PNG |
| icon-64 / -128 / -256 | 64–256 | uz general |
| icon-192.png | 192 | PWA |
| icon-512.png | 512 | PWA / splash |
| icon-1024.png | 1024 | master raster / store |
| apple-touch-icon.png | 180 | iOS home screen |
| maskable-192 / -512 | 192/512 | PWA maskable (safe-zone) |
| icon-reverse-512 | 512 | semn colorat pe fundal deschis |
| icon-coral-512 | 512 | mono coral, fundal transparent |
| icon-mono-white-512 | 512 | mono alb, fundal transparent |
| icon-mono-dark-512 | 512 | mono inchis, fundal transparent |

## HTML (`<head>`)
```html
<link rel="icon" href="/icons/favicon.ico" sizes="any">
<link rel="icon" href="/svg/favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#E23755">
<meta property="og:image" content="/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

## Culori de brand
- Coral `#FF8A5B` -> Rosu `#E23755` (gradient diagonal)
- Coral solid `#FF6B5C`
- Fundal dark `#131318`
- Text deschis `#F5F5F7`
