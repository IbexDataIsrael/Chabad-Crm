# Rebbe photos & quotes (activist route — fixes68 §7)

The activist route flow (`/dashboard/activist/route`) shows a Rebbe photo or
quote on the "divider" screen between buildings/floors. It renders **nothing**
until you add real content here — no placeholder image or quote ships by
default.

## Photos

1. Drop your image files into `public/rebbe/photos/` (any filename — `.jpg`
   or `.webp`, e.g. `01.jpg`, `02.jpg`, ...).
2. List them, in the order you want them to appear, in `manifest.json`:

   ```json
   { "photos": ["01.jpg", "02.jpg", "03.jpg"] }
   ```

## Quotes

Edit `quotes.json` — a plain array, one entry per quote:

```json
[
  { "he": "הציטוט בעברית", "en": "The quote in English", "source": "היכן נאמר / נכתב" }
]
```

`en` and `source` are optional; `he` is always shown when the app is in
Hebrew, `en` (falling back to `he`) when it's in English.

Only real, reviewed quotes belong here — the app never invents or shows a
placeholder quote.

Photos and quotes alternate on the divider screens, each cycling through its
own list independently, and nothing repeats until the whole route has been
walked once.
