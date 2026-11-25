# Hisaab

A simple digital khata (ledger) for a small shop. Track who owes what, record credit and payments, and send a WhatsApp reminder in one tap. Works in English, Hindi and Telugu, on a phone or a computer, and can be installed as an app.

## What's inside

| File | What it does |
|---|---|
| `index.html` | The whole app: pages, design and logic |
| `manifest.webmanifest` | Lets phones install Hisaab like an app |
| `sw.js` | Keeps the app working offline after the first visit |
| `icon.svg`, `icon-192.png`, `icon-512.png` | App icons |
| `vercel.json` | Small hosting setting for Vercel |

No build step, no database, no server. Data is kept in the browser on each phone (localStorage).

## Put it online with Vercel

1. Push this folder to a GitHub repository.
2. On vercel.com, choose **Add New → Project**, pick the repository, and press **Deploy**. Leave every setting as it is.

## Checks from the brief

- Total outstanding: `#total-outstanding`
- One row per customer: `[data-customer="<phone>"]` with the balance in `[data-balance]`
- WhatsApp reminder: `a[data-remind="<phone>"]` → `https://wa.me/91<phone>?text=<message>`
- Import: `#import-box` and `#import-go`
- Payment screenshot: `#shot-input`, saved entries show `img[data-shot]`
- Date: `?today=YYYY-MM-DD` in the address is honoured
