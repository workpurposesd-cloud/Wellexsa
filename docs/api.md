# Express API

## Status

The Express API now contains tested local-development endpoints for identity, customers, staff, catalogue, enquiries, follow-ups, offline showroom sales, reports, activity logs, homepage slides, and public website settings. Tests use mock database/Firebase dependencies. The routes have not been integration-tested against the live MySQL schema.

The existing CRM frontend still uses Firestore and Firebase Functions. It has not been switched to these APIs. Do not remove or disable that path until database migrations/seeds are approved and the API is verified against a disposable MySQL 8.0.42 database.

Responses use:

```json
{ "data": {} }
```

or:

```json
{ "error": { "code": "ERROR_CODE", "message": "Safe public message." } }
```

## Public endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Confirms API availability; no database check. |
| POST | `/api/enquiries` | Submits a public enquiry for a published bike. Requires phone-encryption keys; stores only encrypted phone fields and returns a request ID. |
| GET | `/api/catalog/brands` | Lists active brands. |
| GET | `/api/catalog/categories` | Lists active categories. |
| GET | `/api/catalog/bikes` | Lists published bikes; supports `page`, `pageSize`, `brand`, and `category`. |
| GET | `/api/catalog/bikes/:bikeId` | Returns a published bike only when its associated brand/category is active. |
| GET | `/api/website/slides` | Lists enabled, published slides backed by active public media. |
| GET | `/api/website/settings` | Returns settings marked `public`; private settings are excluded in SQL. |

Public enquiry submission fails closed with `503` until valid phone-encryption and lookup key rings are configured. It does not expose ciphertext, keys, or the submitted phone number in its response.

## Firebase identity

Send tokens as `Authorization: Bearer <Firebase-ID-token>`. Tokens are verified with revocation checking.

| Method | Path | Permission/behavior |
| --- | --- | --- |
| POST | `/api/auth/sync` | Creates or refreshes a Customer profile from verified Firebase identity fields only. Request body must be empty; role and permission fields are rejected. |
| GET | `/api/me` | Returns the mapped user's MySQL role and effective permissions. |

Owner/Staff CRM access requires an active MySQL account and verified email. MySQL determines the role; Firebase custom claims and client-submitted fields do not.

## CRM endpoints

All `/api/crm/*` routes require a verified Firebase ID token and a mapped active MySQL profile.

| Method | Path | Permission |
| --- | --- | --- |
| GET, POST | `/api/crm/customers` | `crm.customers.read.assigned` / `crm.customers.read.all`; create requires `crm.customers.create`. |
| GET, PATCH | `/api/crm/customers/:customerId` | Assigned/all read and update permissions. Staff reads/updates are constrained to their own assigned customers in SQL. Owner reassignment requires `crm.customers.assign` and an active Staff profile. |
| GET | `/api/crm/staff`, `/api/crm/staff/:userId` | `crm.staff.read` (Owner). |
| POST | `/api/crm/staff` | `crm.staff.manage` (Owner). Maps an existing, active, email-verified Firebase account; it does not create Firebase users or set custom claims. Existing MySQL profiles are not promoted. |
| PATCH | `/api/crm/staff/:userId` | `crm.staff.manage` (Owner). On-leave accounts are suspended; terminated accounts are disabled in MySQL. |
| GET | `/api/crm/catalog/bikes`, `/api/crm/catalog/brands`, `/api/crm/catalog/categories` | `catalog.manage` (Owner). |
| POST, PATCH | `/api/crm/catalog/bikes`, `/api/crm/catalog/brands`, `/api/crm/catalog/categories` and their ID paths | `catalog.manage` (Owner). Deactivation/archive states are used instead of destructive deletes. |
| GET | `/api/crm/enquiries`, `/api/crm/enquiries/:id`, `/api/crm/enquiries/:id/history` | Assigned/all enquiry read permissions. Staff access is assignment-scoped. |
| PATCH | `/api/crm/enquiries/:id` | Assigned/all update permissions; Owner reassignment also requires an active Staff profile. Status history is written transactionally. |
| GET, POST | `/api/crm/follow-ups` | Assigned/all read or create permissions. Staff follow-ups are limited to assigned customers and assigned to the actor. Owner-created follow-ups require an active Staff assignee. |
| GET, PATCH | `/api/crm/follow-ups/:id` | Assigned/all read or update permissions. Each scheduled follow-up has its own append-only change history; completed/cancelled records cannot be changed. |
| GET, POST | `/api/crm/sales` | Assigned/all read or `crm.sales.create`. Sales are `INR`, record type `new_showroom`, use transaction-safe items, fixed discounts, server-calculated totals, and an idempotency request ID. Historical purchases remain excluded. |
| GET | `/api/crm/sales/:saleId` | Assigned/all sale-read permission. |
| GET | `/api/crm/dashboard` | `reports.read` (Owner). Includes aggregate customer, enquiry, follow-up, bike, and current-day new showroom sale totals. |
| GET | `/api/crm/activity-logs` | `activity_logs.read` (Owner). Filters are parameterized; details JSON is not returned. |
| GET, POST, PATCH | `/api/crm/homepage-slides` and `/api/crm/homepage-slides/:slideId` | `homepage_slides.manage` (Owner). Published slides require active public media. |
| GET | `/api/crm/website-settings` | `website_settings.manage` (Owner). |
| PUT | `/api/crm/website-settings/:settingKey` | `website_settings.manage` (Owner). Setting values are JSON, limited to 64 KB. |

The API does not expose encrypted phone columns or decryption keys. A phone-read workflow and media upload/replacement API are not implemented. Bike image management is therefore not available through the catalogue endpoints.

## Operational limits and verification

The API applies a per-process, per-IP limit of 120 requests per minute and a 32 KB JSON body limit. This in-memory limiter is for a single local process; multi-instance deployments need a shared store.

The current tests run with Node's built-in test runner and use mocks. No migration, seed, live MySQL verification, Firebase production operation, deployment, or frontend cutover is performed by these tests.
