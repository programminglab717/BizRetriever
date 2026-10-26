# Runbook: the Shopify app (M10, ADR-059)

**What it is:** the free app BizRetriever uses to read a shop's products, stock, customers and orders.
It never writes to the store. Everything in the code is built and tested against recorded answers;
the steps marked **Owner** need a Shopify account and are the owner's to do.

## 1. Create the app (Owner, free)

1. Create a free Shopify Partner account, then open the **Dev Dashboard** and create an app.
2. In the app's configuration:
   - **App URL:** `https://<APP_URL>/` (BizRetriever's address)
   - **Allowed redirection URL:** `https://<APP_URL>/api/connect/shopify/callback`
   - **Access scopes:** `read_products`, `read_inventory`, `read_orders`, `read_customers`. Add
     `read_all_orders` if shops need more than their last 60 days of orders.
   - **Protected customer data:** request access to customer names and emails. Without it Shopify
     hides them and customers come in without names.
   - **Webhooks:** `app/uninstalled` → `https://<APP_URL>/api/connect/shopify/webhooks`. The
     privacy webhooks `customers/data_request`, `customers/redact` and `shop/redact` go to the same
     address.
3. Copy the **Client ID** and **Client secret**.

## 2. Configure BizRetriever

Set these on the web app and the worker, never in the repository:

```
SHOPIFY_CLIENT_ID=<client id>
SHOPIFY_CLIENT_SECRET=<client secret>
CONNECTOR_SECRET=<openssl rand -hex 32>   # encrypts stored tokens; keep it, or stores must reconnect
SHOPIFY_API_VERSION=2026-07              # a supported version; review each quarter
```

"Connect your Shopify store" then appears on the import page.

## 3. First live check (Owner, with a free development store)

1. In the Partner account, create a **development store** and add a few products, customers and
   test orders.
2. In BizRetriever: My data → Add or update files → "Connect your Shopify store" → enter the
   development store's address → approve in Shopify.
3. Expected:
   - back on My data, "Your Shopify store is connected"
   - within a minute, an import to check with products, customers and sales
   - after approving it, the dashboard fills
4. Add an order in Shopify, then press "Update now" on My data. Expected: the order comes in by
   itself, with nothing to approve.
5. Uninstall the app in Shopify. Expected: My data shows the store as removed, and the records stay.
6. If a step fails, check the server log for module `shopify`. Likely causes are a field renamed in
   the API version or a missing scope.

## 4. Privacy requests

Shopify sends these when a shop's customer asks for their data or for it to be erased. `/admin` lists
them under "Shopify privacy requests". Within 30 days:

- **customers/data_request:** send the shop owner the customer's records (My data → Customers →
  search the customer, "Download all my data" for the business).
- **customers/redact:** remove the customer's name, email and phone from their records (My data →
  the customer → edit), or delete the record.
- **shop/redact:** BizRetriever has already disconnected the store. Ask the owner whether to delete
  the business, or delete it after 30 days if they have left.

Before listing the app publicly, automate these (roadmap).

## 5. Rotating secrets

- **Client secret:** rotate it in the Dev Dashboard, update `SHOPIFY_CLIENT_SECRET`, redeploy.
  Tokens keep working.
- **`CONNECTOR_SECRET`:** changing it makes stored tokens unreadable. Each store then shows "connect
  it again".
