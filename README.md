# Snus Tracker

A standalone tracker for lip pillows (nicotine pouches). No AI, no server, no account: it runs in any browser and keeps your data on your device.

## Features
- **Limits:** set a daily limit. Weekly (daily × 7) and monthly (daily × days in the month) are worked out automatically, or set them yourself. Weeks start on Monday.
- **Log a lip pillow:** one tap on **+1 lip pillow** saves it at the current time. Forgot one earlier today? Change the time field above the button first (tap **Now** to go back). You can also undo the last one, or change the time on or delete any of today's lip pillows.
- **What were you doing? (optional):** after each log, tap Studying/Working, Outside, Drinking, Misc., or Other (type your own), or Skip. Change it later from today's list. A breakdown shows what you were doing over the last 30 days.
- **Feedback:** "2 lip pillows left today", "That's your limit for today", "You went over today's limit by 2 lip pillows", "Stayed within your daily limit 3 days in a row", "Longest gap today: 3h 10m".
- **Time:** time of your last lip pillow and how long ago it was, plus a morning/afternoon/evening/night breakdown for the last 30 days.
- **Trend graph:** lip pillows per day over the last 7, 30 or 90 days, with your daily limit as a dashed line. Days over the limit are marked in red.
- **History:** the last 30 days, each marked as within the limit or over it.
- **Backup:** export to a file and import it on another device.

## Use it
- **On your phone:** open the hosted page (e.g. GitHub Pages), then use Share → **Add to Home Screen** (iPhone) or menu → **Install app** (Android). It then opens like an app and works offline.
- **On a computer:** open `index.html` in a browser, or run `npm start` and visit the address it prints.

Data is stored in the browser you use, so each device has its own copy. Use Export/Import to move it.

## Files
- `index.html`: the page
- `logic.js`: all the counting, limits and feedback (no DOM, tested)
- `app.js`: connects the page to the logic
- `sw.js`, `manifest.webmanifest`, `icon*`: offline support and home-screen install

## Tests
```
npm test
```
