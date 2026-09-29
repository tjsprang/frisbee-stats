# Frisbee Stats

Live stat tracking for ultimate frisbee leagues. It's a single page (`index.html`) backed by [Supabase](https://supabase.com) for accounts, league data and live updates.

## Features

- Email and password sign-in that stays signed in
- Leagues that are searchable, joined with a league password, with several admins each
- Live game tracking: goals and assists, Ds, Callahans, throwaways (with blocks), drops, halftime and undo
- Lineups and points played
- Box scores and sortable season leaderboards
- Schedule creator (round robins or a set number of rounds, with fields and times)
- Live updates on every device, and a save queue that keeps working through spotty signal

## Setup

1. Create a Supabase project. In the SQL Editor, run the scripts in `supabase/` in order (`001`, `002`, `003`).
2. Put your project URL and publishable (anon) key into `SUPABASE_URL` and `SUPABASE_KEY` near the top of the script in `index.html`.
3. In Supabase, go to **Authentication → URL Configuration**. Set the **Site URL** to where the app is hosted, and add it under **Redirect URLs**.
4. Host `index.html` anywhere static, for example GitHub Pages.
