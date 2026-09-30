# Frisbee Stats

Live stat tracking for ultimate frisbee leagues. It's a static page (`index.html`, plus `stats.js` for the stats engine and charts) backed by [Supabase](https://supabase.com) for accounts, league data and live updates.

## Features

- Email and password sign-in that stays signed in
- Leagues that are searchable, joined with a league password, with several admins each
- Pass-by-pass live tracking: pulls, pickups, every completion, goals, throwaways (with blocks or Callahans), drops, stalls, halftime and undo
- Lineups, points played, and O-line/D-line points worked out from who pulled
- UltiAnalytics-style stats (Summary, Passing, Receiving, Playing time, Defense and Per point), with the same formulas (see [their calculations](https://www.ultianalytics.com/calcs.html))
- Seasons: end a season and start the next (from scratch or with the same teams), all-time stats across seasons, and a Hall of Fame
- Team pages (record, point spread, offensive productivity, conversion rate, holds and breaks, passes per possession, points per line, assists-to-goals flow), game pages (score chart, point-by-point), and player pages
- Public read-only links, player photos and bios, game availability (In / Maybe / Out), and CSV export
- Standings, playoff brackets seeded from the standings, in-app notifications, and an installable app that works offline
- Schedule creator (round robins or a set number of rounds, with fields and times)
- Live updates on every device, and a save queue that keeps working through spotty signal

## Setup

1. Create a Supabase project. In the SQL Editor, run the scripts in `supabase/` in order (`001` through `011`).
2. Put your project URL and publishable (anon) key into `SUPABASE_URL` and `SUPABASE_KEY` near the top of the script in `index.html`.
3. In Supabase, go to **Authentication → URL Configuration**. Set the **Site URL** to where the app is hosted, and add it under **Redirect URLs**.
4. Host the folder anywhere static over https, for example GitHub Pages (the service worker needs https).
