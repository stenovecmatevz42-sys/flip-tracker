# MS Mobile

Personal phone-flipping tracker, built as an installable web app (PWA). Stock with sell-by targets, profit, price check and a sold-by-model chart.

- Frontend: plain HTML, CSS and ES modules. No build step. Hosted on GitHub Pages.
- Backend: Supabase (Postgres + Auth). Row level security allows only the owner account to read or write.
- Offline: a service worker keeps the app shell, and the last synced data is cached on the device.

## Setup

1. Create a Supabase project and run the SQL for the schema (`phones`, `phone_photos`, `app_owner`, `is_owner()` and the row level security policies).
2. Put the project URL and the anon (publishable) key into `js/config.js`. The anon key is safe to publish; access is enforced by row level security.
3. In Supabase, Authentication, Email: turn off "Confirm email" while setting up.
4. Enable GitHub Pages for this repository (Settings, Pages, deploy from the `main` branch, root folder).
5. Open the page, create the account, then add that account to `app_owner`.
6. Turn off new sign-ups in Supabase once the owner account exists.

## Install on a phone

iPhone: open the Pages URL in Safari, Share, Add to Home Screen.
Android: open it in Chrome, menu, Install app.

No personal data lives in this repository. Phone records and photos are stored only in the Supabase database.
