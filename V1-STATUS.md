# V1.1 delivery — Pizza & Bar POS

Updated 16 October 2026. Stack: Laravel 13, React 19, TypeScript, Tailwind CSS 4, Inertia and MySQL 8. No Docker. Ready for local review and restaurant acceptance testing; not a claim of production deployment.

## Restaurant and Bar update

- Send food was removed from checkout. Staff can pay directly for food items without creating a kitchen ticket first. Pay spans the available width. Automatic printing remains deferred; payment does not dispatch tickets or print automatically.

- Kitchen display and kitchen-only login are disabled for the current printer-only operation. Old kitchen sessions are denied access. Staff retain the manual Print tickets queue and receipt previews. Automatic printer setup, Bar routing and payment-triggered printing remain deferred; no claim of automatic hardware printing is made.

- Booking forms now fetch available tables for the selected start/end time and guest count using the business timezone. Conflicting, inactive, undersized and currently occupied tables (for bookings starting now) are omitted. Editing excludes the booking itself; adjacent bookings remain allowed. Availability refreshes every five seconds; transaction-based save validation remains authoritative.


- 19 October: products can select multiple shared extras lists using searchable checkboxes. Product-specific extras text entry is removed; existing extras remain available for Restaurant products. Bar products offer no extras. Existing ordered items keep their recorded prices/configurations.
- Delivery orders require a customer name, phone and address, with an optional fee. Delivery uses takeaway pricing and the existing checkout/refund flow. The fee is included in the subtotal and receives the order's configured taxes and discounts; department allocation follows item value. Product-sales lines exclude the separate fee, while order sales totals include it. Receipts show the delivery address and fee; KOTs identify Delivery.
- Optional order notes are edited from the order summary. Manager/Admin has a Close day shortcut to the existing Overview closing workflow; unpaid orders still block final close. Cashiers submit their daily summaries from My day.
- Apply `php artisan migrate` for the delivery fields and multiple-extras links before using this update. Existing single-list links are copied automatically.

- Business settings now include a system-wide currency picker and configurable cash rounding. Prices, payments, tips, refunds, history, reports, CSV labels and customer receipts follow the selected currency. Existing installations retain CAD and 0.05 cash rounding by default. Supports 16 two-decimal currencies. Changing currency relabels all amounts, including historical sales; it does not perform exchange-rate conversion. No database migration is needed for these settings.

- Simple All items / Restaurant / Bar menu switch, one mixed bill and one checkout.
- Department is saved on each order item. Later menu edits do not rewrite sales history.
- Separate and combined reports, CSV exports, a department revenue chart and print-friendly reports. Refunds use the original item departments.
- Mixed bills allocate discounts, tax, optional tips and rounding proportionally by item value with deterministic cent rounding. Department monetary totals add to the combined total. Collections reconcile to department net sales + tax + tips + rounding. Tips still belong to the attending employee. Mixed orders count once in each department they contain, so department order counts are not additive.
- Existing sales from before this update remain Unassigned and are included in combined totals. Existing products start in Restaurant except those in a category named Bar. Review product departments before taking new orders.
- Running-order cards show table/customer, elapsed time, latest kitchen status and total; click to resume.
- Tables have an editable area and department. Filter areas such as Restaurant, Bar or Patio. Reservation department reports use the table's current department.
- Optional product photos are resized in the browser and stored as small thumbnails; icon fallback remains. Shared extras lists can be reused by multiple products; edits affect future items only.
- Optional takeaway base price defaults to the regular price when blank. Variants retain their configured variant prices.
- Existing KOT and customer receipt pages remain separate print previews. Physical printing still needs on-site testing.

## Upgrade an existing installation

Back up the MySQL database and preserve the existing `.env` and `APP_KEY`. Copy the updated source and compiled frontend, then run `composer install`, `php artisan migrate --force`, and `php artisan optimize:clear`. If rebuilding frontend assets, run `npm ci` and `npm run build`. Do not run `migrate:fresh` or the demo command against a live database. In Manage → Menu, review each product department; in Manage → Tables, set areas and departments.

## Completed

| Area | V1 behavior |
|---|---|
| UI | Reference-inspired rounded panels, dark navigation, tomato-red accents, responsive desktop/mobile layouts and centred dialogs. Tailwind theme/utilities with custom component styling. |
| Login | PIN-only keypad, no employee-name cards. Unique 4–8 digit PINs across all staff and kitchen access; hashed PIN storage and throttled login. Staff role controls and kitchen-only access are enforced on the server. |
| Team | Manager provisions Admin/Cashier accounts; Admin manages Cashiers. Enable/disable accounts and reset PINs. Active/inactive state, login, last-seen and logout timestamps; detected inactivity is labelled separately from exact logout. |
| POS | Dine-in/takeout, table status, attendants, customer notes, menu search/categories, variants, extras, quantity/instruction changes, cancellation reasons and audit history. |
| Kitchen | Screen, printer, or both. Incremental food-only KOTs, new/preparing/ready/completed states, optional sound, ready notification, explicit amendment/cancellation tickets and acknowledgement. The Send to kitchen flag controls KOT independently of the Restaurant/Bar department. |
| Printing | Separate kitchen tickets without prices and financial customer receipts. Print/reprint links and browser print dialogs; printer-only queue has explicit printed confirmation. |
| Bookings | Configurable default duration, explicit start/end times, overlap rejection, adjacent time slots allowed, edits, cancellation, no-show, seating and completion. Tables release immediately after payment. |
| Discounts | Predefined discounts/promo codes, one per order, eligibility dates/use limits and snapshotted selected value. No arbitrary cashier discount. |
| Payments | Cash with change/rounding, external-card terminal recording with reference and confirmation; optional zero/default tips allocated to the attendant. Duplicate-payment protection and stale-order checks. |
| Refunds | Full refunds only, including tax/tips; Manager/Admin approval PIN, reason, recorded external-card refund confirmation and audit trail. |
| Daily operation | Manager/Admin opens the day. Cashiers submit personal daily summaries. Manager/Admin performs final close; unpaid orders block close. Most recent closed day can reopen with a reason. |
| Management | Menu/category creation, products/availability, tables, offers, terminals, reconciliation, timezone, configurable taxes and receipt details. |
| Reports | Date-range sales, cash/card collections, tax, refunds, tips, staff totals, products, offers, reservations and terminal totals; CSV export. Searchable paginated order history with receipt/refund access. |
| Outages | Work pauses on connection loss; no offline payment/order queue. Five-second state polling with optional self-hosted Reverb. |
| Delivery | Source, dependency lockfiles, compiled frontend, migrations, demo seed, tests and Windows setup guide. No credentials, database contents or dependency folders in the archive. |

## Verification completed

- All MySQL migrations and the demonstration seed ran on MySQL 8.0.46.
- **26 automated PHP tests passed, with 243 assertions.** Coverage includes payments, optional tips, full refunds, role restrictions, overlapping bookings, kitchen ticket increments/changes, closing, unique PINs, print permissions, order history and activity timestamps.
- **1 browser end-to-end scenario passed** in Chromium headless: PIN-only login, business-day opening, Both output setting, sale, KOT print page without prices, customer receipt, Restaurant/Bar menu and report filters, CSV filter links, centred dialog geometry, mobile layout and kitchen-only login. No page JavaScript errors were reported in that scenario.
- TypeScript check and production Vite/Tailwind build passed.
- PHP code formatting completed. Desktop and mobile browser screenshots were inspected internally.

## Still needed before live use

1. Install on your intended computer/server; configure the real business, timezone, menu, tables, employees, unique live PINs and applicable taxes.
2. Test physical KOT and counter printers: selected device, paper width, scaling, print quality and reprint workflow. Actual hardware was not available here.
3. Test with your real payment terminal and receipts/refund references. No payment-provider API is connected; terminal transactions are recorded manually.
4. Run restaurant staff acceptance testing, including multiple simultaneous devices, a full day-close/reopen cycle and network interruptions. Backend locking is implemented, but a multi-device load/concurrency stress test has not been run.
5. Configure production hosting, HTTPS, secure cookies, restricted database credentials, automated backups and verify a restore. The app has not been deployed to a live restaurant.
6. If choosing Reverb, configure and verify its WebSocket/queue processes on the target server. The tested default is polling, not the optional Reverb deployment.
7. Verify target browsers/devices, especially Safari/iPad and actual touch terminals. Automated browser coverage is Chromium at desktop/mobile viewport sizes, not every physical device/browser.

## Deliberately outside this V1

Silent printer routing/raw ESC/POS integration, online payment processing, deposits, partial refunds, split payments, cash-drawer control, inventory, multi-location operation and offline synchronization. These are not silently included or claimed as complete.

## Quick access

Read `SETUP-WINDOWS.md` first. Demo PINs: Manager **4826**, Admin **5937**, Cashier **6148**, Kitchen/KOT **7259**. These exist only after `php artisan pos:demo`; a normal installation requires a Manager-created kitchen PIN.

Older planning documents that mention PostgreSQL or Docker are superseded by this delivery and its MySQL/no-Docker setup guide.
