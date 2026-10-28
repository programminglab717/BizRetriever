# Runbook: QuickBooks, Xero, Square and WooCommerce (M18)

The four connectors are built (ADR-068) and tested on recorded answers. Each button on
**My data → Bring in your files** stays hidden until its keys are set. All four only ever read.

Every connector needs `CONNECTOR_SECRET` set (it seals stored tokens and keys) and a public
`https://` `APP_URL`. Callback addresses below use `APP_URL`.

## WooCommerce: no account needed

1. Nothing to register: WooCommerce's app approval page is part of every store.
2. It appears once `CONNECTOR_SECRET` is set and `APP_URL` starts with `https://`. The store has to
   post the key to an https address it can reach, so a localhost machine can't receive it.
3. The owner types their store's address, approves "Read" on their own WordPress admin, and is
   sent back to My data.

## QuickBooks Online

1. Create a free developer account and an app at developer.intuit.com (the Builder tier is free).
2. Under the app's Keys & credentials (Production), add this redirect URI:
   `https://<APP_URL host>/api/connect/quickbooks/callback`.
3. Scope: Accounting (`com.intuit.quickbooks.accounting`). Intuit has no read-only scope; our code
   only reads.
4. Set `QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_CLIENT_SECRET`.
5. For a first try, use the sandbox keys with `QUICKBOOKS_ENVIRONMENT=sandbox` and a sandbox
   company.
6. The free tier meters reads (500,000 a month). A daily check uses a few calls per company.
7. Production apps go through Intuit's app assessment (a questionnaire) before any company outside
   your own can connect.

## Xero

1. Create a free app at developer.xero.com/app/manage (type: Web app).
2. Redirect URI: `https://<APP_URL host>/api/connect/xero/callback`.
3. Apps created since 2 March 2026 get granular scopes only. We ask for:
   - `accounting.invoices.read`
   - `accounting.payments.read`
   - `accounting.contacts.read`
   - `accounting.settings.read`
   - `offline_access`, plus `openid profile email`

   Check the app accepts these names; Xero's scopes page lists them.
4. Set `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`.
5. The free Starter tier allows **5 connected organisations** and about 1,000 calls a day each.
   That's enough to test and for the first customers; more needs a paid tier (R49).

## Square

1. Create a free application at developer.squareup.com/apps.
2. Under OAuth, set the redirect URL: `https://<APP_URL host>/api/connect/square/callback`.
3. Set `SQUARE_APPLICATION_ID` and `SQUARE_APPLICATION_SECRET`. Use the sandbox credentials with
   `SQUARE_ENVIRONMENT=sandbox` first (keep the sandbox seller dashboard open in another tab while
   approving).
4. `SQUARE_API_VERSION` defaults to `2026-09-16`. Raise it when Square retires that version.

## Checking a connection

- **A connection appears under My data → Linked sources.** Its first check starts an import the owner
  reviews, like a file.
- **"Needs attention"** means the provider stopped letting us in: the owner revoked access, or a
  refresh token expired after a long time unused. The owner connects it again. Records stay.
- **What's read:**
  - QuickBooks and Xero: sales invoices, customers, payments (businesses that keep payments, such as
    wholesale), and products.
  - Square and WooCommerce: products with stock, customers and orders.
  - The first check reads the last year. Later checks read what changed since the day before the
    last check; older records are kept.
