# Forno Pizza & Bar POS — V1

Laravel 13 · React 19 + TypeScript · Tailwind CSS 4 · Inertia · MySQL 8. No Docker and no SQLite.

A single-location point of sale with PIN-only staff/kitchen login, table bookings, kitchen display and ticket printing, counter receipts, cash/external-card payment recording, full refunds, optional employee-owned tips, daily closing and reports.

Start with [SETUP-WINDOWS.md](SETUP-WINDOWS.md). See [V1-STATUS.md](V1-STATUS.md) for delivered features, test evidence and remaining on-site work.

## Structure

- `app/Services`: order/payment rules, management, reporting, integer-cent calculations and PIN checks.
- `app/Http`: authenticated routes, PIN login and role controls.
- `resources/js/Pages`: React POS, kitchen, management, reports and order history.
- `resources/css/app.css`: Tailwind theme/utilities and reference-inspired component styling.
- `resources/views`: separate KOT and customer receipt print layouts.
- `database/migrations`: MySQL schema.
- `tests/Feature`, `tests/Unit`, `tests/e2e`: regression coverage.

## Local development

Install dependencies, configure MySQL in `.env`, run migrations/seed settings, create the Manager, then run `php artisan serve` and `npm run dev` in separate terminals. Production assets: `npm run build`.

## Design decisions

- One Laravel application serves the React UI through Inertia: no separate API deployment or authentication service.
- All monetary calculations use integer cents. Product prices and tax rules are captured on orders; selected discounts are captured so later offer edits do not silently change a bill.
- State-changing operations validate data and enforce roles on the server. Order versions detect stale edits. Payment/request keys and database constraints prevent duplicate payment recording.
- PINs are hashed. All staff accounts, including disabled accounts, and the kitchen PIN share the uniqueness rule. Login does not expose a staff-name directory.
- Database transactions protect order mutations, payments, bookings and day closing. Audits retain important changes and reasons.
- Kitchen refresh uses five-second polling by default. Optional self-hosted Reverb reduces delay. Neither requires a paid service.
- No offline writes or deferred payment queue. A disconnected UI asks staff to wait.
- Printing uses browser print dialogs and installed device drivers. Payment terminal approval/refund happens on the physical terminal; this app records its reference.

## Tests

Create a dedicated `restaurant_pos_test` MySQL database and grant the local development user access. Run `php artisan test`. Do not give the test environment production database credentials.

Browser test: on a fresh local demo database, run the application, install Playwright Chromium with `npx playwright install chromium`, then run `npm run test:e2e`. It creates a demo sale and changes kitchen output to Both. Use only a disposable demonstration database. `POS_URL` optionally changes the server address. `CHROMIUM_PATH` optionally selects a locally installed test browser.

## License

The Laravel scaffold retains its original MIT license. Third-party dependencies retain their own open-source licenses.

## Restaurant and Bar update

See `V1-STATUS.md` for the department reporting rules, new menu/table options, verification and upgrade steps. Keep the existing `.env` and database when upgrading.
