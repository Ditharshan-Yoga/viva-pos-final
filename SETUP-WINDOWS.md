# Windows setup — V1

## 1. Open the project

Extract the ZIP into `D:\Projects` and open `D:\Projects\restaurant-pos` in VS Code. No Docker is needed.

## 2. Prerequisites

- PHP 8.3+ with PDO MySQL, mbstring, OpenSSL, ctype, fileinfo, XML/DOM, tokenizer, curl and zip.
- Composer 2.
- Node.js 22.12+ and npm.
- MySQL 8 running locally.

Check `php -v`, `composer -V`, `node -v` and `php -m`. `php --ini` identifies the configuration file where you can enable `pdo_mysql`.

## 3. Create the MySQL database

Run in MySQL Workbench as your local database administrator. Replace the example password.

```sql
CREATE DATABASE restaurant_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'restaurant_pos'@'127.0.0.1' IDENTIFIED BY 'your-own-password';
GRANT ALL PRIVILEGES ON restaurant_pos.* TO 'restaurant_pos'@'127.0.0.1';
```

In PowerShell inside the project:

```powershell
Copy-Item .env.example .env
composer install
npm ci
php artisan key:generate
```

Edit `.env` and set `DB_PASSWORD`. Defaults already select MySQL, host `127.0.0.1`, port `3306`, and database/user `restaurant_pos`. Keep `.env` private.

```powershell
php artisan migrate --seed
php artisan pos:manager
```

Enter the Manager's name and a unique 4–8 digit PIN. There can be one Manager. Add Admin and Cashier accounts from Manage/Team after signing in. Every PIN must be unique, including the kitchen PIN.

## 4. Start the application

Terminal 1:

```powershell
php artisan serve
```

Terminal 2:

```powershell
npm run dev
```

Open http://127.0.0.1:8000. Enter your PIN directly. There are no employee cards to select. Staff PINs open the role-controlled staff workspace; the kitchen PIN opens only the kitchen workspace. Keep both terminals running; Ctrl+C stops them.

Errors appear in the terminals and `storage/logs/laravel.log`.

## 5. Configure the restaurant

In Manage → Business, set the business details, timezone, taxes, default booking duration, receipt footer and kitchen PIN. No tax rate is assumed. Under Kitchen output choose **KOT screen**, **KOT printer**, or **Screen and printer**.

Add menu items, variants/extras, tables, offers, employees and terminal details. Manager/Admin starts the business day before sales. Tips are optional and default to zero. At closing, cashiers submit their own summary; Manager/Admin performs the final business-day close after open orders are paid or cancelled.

## 6. Kitchen and customer printing

**Current update:** The kitchen display and kitchen PIN login are disabled. Staff can use **Print tickets** for existing manual ticket previews and printed confirmation. Automatic Kitchen/Bar/Cashier printer routing remains on hold. The screen/Both setup instructions below describe the older version and do not apply to the current interface.

### Currency

In Manage → Business, choose the currency and save settings. The selection applies to menu prices, checkout, tips, refunds, history, reports, CSV exports and customer receipts. Existing installations default to CAD. Other open devices pick up the setting on their next refresh.

This is one currency for the whole installation, including past sales and reprinted receipts. Changing it relabels existing amounts; it does not convert prices or historical sales. Choose the business currency before live trading. The picker supports 16 two-decimal currencies, including LKR, USD, CAD, EUR and GBP; zero- and three-decimal currencies are not supported.

Cash rounding is configurable separately. Existing installations retain 0.05 rounding; choosing another currency resets the form to no rounding. Review this setting before saving. Card payments are not rounded. Extras and variants accept numeric prices, or the selected currency code/symbol before the price.

- **Screen:** staff send food to the kitchen; kitchen staff enter their PIN to see New → Preparing → Ready → Completed. Press Sound on once per browser session to enable alerts.
- **Printer:** sending food displays a Print KOT link. Choose the kitchen printer in the print dialog. The Kitchen section also provides the print queue and reprints. Confirm printed only after physically checking the ticket.
- **Both:** use the live kitchen screen and Print KOT links together.
- After payment, select View receipt, then Print receipt, and choose the counter/customer printer.
- KOT tickets contain food and preparation instructions, without prices. Customer receipts contain financial totals. Sent-item amendments and cancellations produce clearly labelled separate kitchen tickets.
- Reprinting prints the same ticket identifier. Check for duplicates before preparing food.
- Use the paper size supported by your device; choose appropriate margins/scaling and disable browser headers/footers. Verify clipping on the actual printer.

Browsers control printer selection. This V1 does not silently route jobs to two physical printers or issue raw ESC/POS commands. A native print bridge or kiosk configuration would be additional work if silent printing is required.

## 7. Optional demonstration data

On a fresh local database with no users, use `php artisan pos:demo` instead of `php artisan pos:manager`.

| Demo portal | PIN |
|---|---|
| Manager | 4826 |
| Admin | 5937 |
| Cashier | 6148 |
| Kitchen / KOT | 7259 |

These are demonstration credentials only. A normal installation has no default kitchen login until the Manager sets its PIN. Never use the demo database for live business.

## 8. Optional Reverb

Five-second polling works without extra processes. For self-hosted WebSockets, set the following in `.env`, using your own generated values:

```dotenv
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=forno-pos
REVERB_APP_KEY=your-generated-key
REVERB_APP_SECRET=your-generated-secret
REVERB_HOST=127.0.0.1
REVERB_PORT=8080
REVERB_SCHEME=http
VITE_REVERB_APP_KEY="${REVERB_APP_KEY}"
VITE_REVERB_HOST="${REVERB_HOST}"
VITE_REVERB_PORT="${REVERB_PORT}"
VITE_REVERB_SCHEME="${REVERB_SCHEME}"
```

Run `php artisan config:clear`, restart Vite, and start `php artisan reverb:start` and `php artisan queue:work` in separate terminals. For multiple devices, use a reachable server hostname, trusted HTTPS/WSS and appropriate network configuration. Polling remains the fallback.

## 9. Before live use

Use real menu/tax settings and unique live PINs. Configure HTTPS, `APP_ENV=production`, `APP_DEBUG=false`, secure session cookies, web-server document root `public`, and restricted MySQL credentials. Set up automatic database backups and test restoring one. Confirm real receipt/KOT printers, terminal references/refunds, cash rounding, timezone and multi-device ordering with your team.

This ZIP is the application source and compiled frontend; dependency folders and live database/credentials are intentionally excluded.
