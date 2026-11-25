# Hisaab

A simple digital khata (ledger) for a small shop. Track who owes what, record credit and payments, and send a WhatsApp reminder in one tap. Works in English, Hindi and Telugu, on a phone or a computer, and can be installed as an app.

Live: https://hisaab-lhpt.vercel.app/

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout |
| `styles.css` | The Peacock design (light and dark) |
| `js/core.js` | Money rules, import, CSV, screenshot-amount reading, Telugu/Hindi typing. No browser code, so it is tested in Node |
| `js/app.js` | Screens, forms and saving in the browser |
| `js/i18n.js` | Every word on screen in English, Hindi and Telugu |
| `js/sample-data.js` | The example shop from the brief's sample file |
| `manifest.webmanifest`, `sw.js`, icons | Install as an app, work offline |
| `tests/core.test.js` | Automatic tests against `tests/fixtures/sample-*.json` |
| `tests/e2e.js` | Browser check of a running site (needs Playwright) |

No build step, no database, no server. Data is kept in the browser on each phone (localStorage). Reading the amount from a screenshot uses Tesseract.js, loaded only when a picture is added.

## Tests

```
node --test tests/core.test.js
node tests/e2e.js https://hisaab-lhpt.vercel.app/
```

## Checks from the brief

- Total outstanding: `#total-outstanding`
- One row per customer: `[data-customer="<phone>"]` with the balance in `[data-balance]`
- WhatsApp reminder: `a[data-remind="<phone>"]` → `https://wa.me/91<phone>?text=<message>` (includes a `upi://pay?pa=...&am=...` link)
- Import: `#import-box` and `#import-go`
- Payment screenshot: `#shot-input`, saved entries show `img[data-shot]`
- Date: `?today=YYYY-MM-DD` in the address is honoured

## Put it online with Vercel

Import the GitHub repository on vercel.com, leave every setting as it is, and press Deploy. Make sure Deployment Protection (Vercel Authentication) is off so anyone can open the link.
