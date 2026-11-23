# WELLEXSA MOTORS

A responsive electric-scooter showroom with customer accounts, live Firestore listings and Firebase Storage images. Administrator pages, provisioning and privileged access are temporarily disabled; existing Firebase data is retained.

## Brand and design assets

- The supplied WELLEXSA emblem and wordmark PNG is used as the logo throughout the website without recreating the artwork. Its white artwork is placed against a charcoal background for legibility.
- The homepage slider uses eight local fallback slides; enabled, published Firestore slides override them. The active demo previews use `assets/images/image1.png` for Tunwal Alfa Pro and `assets/images/image2.jfif` through `image8.jfif` for Tunwal Mini Lithino, Tunwal Sport 63, YO Bykes YO Smart+, YO Bykes YO Smart, YO Bykes YO DX, WELLEXSA Double Light and EoX Electric OKO, respectively. The image9.jfif and image10.jfif files are retained but are not used in the active demo catalogue.
- `privacy.html` and `terms.html` are starter pages, clearly marked for showroom business review. Confirm the final legal, data-retention, cancellation, delivery and warranty terms before launch.

## What is included

- Public showroom with live, published-only listings, scooter detail pages and showroom contact links.
- Enabled, published homepage slides remain visible to customers. Administrator slide management is temporarily unavailable.
- Firebase customer signup, sign-in, account page and sign-out.
- Administrator sign-in, dashboard and provisioning are temporarily disabled. Existing admin accounts and records are not deleted.
- A separate, private Owner/Staff CRM is implemented under `crm/`; it uses server-checked `crmAccess` records and does not restore legacy administrator claims or admin pages. It is not available on the live site until its Functions, Firestore rules, indexes and hosting assets are deliberately deployed.
- Existing published bikes and customer purchases remain available; privileged inventory changes are temporarily unavailable.
- The scooter catalogue displays published product details, prices, specifications and stock. Customers contact the showroom through product enquiries; the website does not offer online checkout.
- Existing customer order history remains available as read-only history. New orders are not created through the website.
- The **SAVE & PUBLISH BIKE** workflow requires a main image, price, name and the five required specifications. Optional fields do not block publishing.
- **Use DECCAN R details** fills the requested DECCAN R – RAYA FLUX information into the form. Add the showroom's original three-angle product photo before publishing; the original photo was not included in this project, so the website does not substitute an invented DECCAN R image.
- Firebase Web App configuration is populated for project `wellexsa`; confirm it is the showroom's intended Firebase project before deploying. No Firebase service-account credentials or demonstration logins are included.

## Engineering documentation

- [API status and current endpoints](./docs/api.md)
- [Database operations and data handling](./docs/database.md)
- [Firebase CRM migration plan](./docs/firebase-crm-migration.md)
- [Deployment readiness checklist](./docs/deployment-checklist.md)

## Local Express and MySQL backend

The implemented Express server provides Firebase ID-token verification, transaction-backed customer, staff, enquiry, follow-up and sale operations, catalogue and website-content APIs, Owner reporting/audit APIs, versioned phone encryption for public enquiries, and MySQL-backed role/permission checks. See [docs/api.md](./docs/api.md) for the routes and their current limits. The routes have automated tests, but have not been integration-tested against the live MySQL schema.

The existing Firebase CRM frontend has **not yet been migrated** to the Express/MySQL API. The pages under `crm/` and the existing Firebase Functions/Firestore CRM operations remain in place and unchanged. Deploying or starting the Express backend does not switch the live CRM from Firebase to MySQL. Cutover requires separately approving the schema and seed, verifying the API against a disposable database, and updating the CRM integration. MySQL migrations and reference seeds are never run automatically at startup.

The server reads local settings from `server/.env`; this file is ignored by Git. From Command Prompt, copy the example and edit only the copy:

```cmd
cd /d C:\Users\COMP\Desktop\Wellexsa\server
copy .env.example .env
```

In the MySQL client, an administrator can create the local database and a dedicated account with a generated password, then grant the app only the requested data permissions:

```sql
CREATE DATABASE IF NOT EXISTS wellexsa
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'wellexsa_app'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
GRANT SELECT, INSERT, UPDATE, DELETE ON wellexsa.* TO 'wellexsa_app'@'127.0.0.1';
SHOW GRANTS FOR 'wellexsa_app'@'127.0.0.1';
```

MySQL displays the generated application password when it creates the account. Save it directly into `MYSQL_PASSWORD` in `server/.env` and a password manager; do not paste it into source files, commit it, or send it in chat. This `CREATE USER` statement intentionally does not overwrite an existing account. If it reports that the account already exists, stop and inspect its grants before deciding whether to reuse or rotate it. Do not put the MySQL administrator password in `.env`.

After setting `FIREBASE_PROJECT_ID`, `CORS_ORIGINS`, and the MySQL settings in the local `.env`, run the safe connection check from `server/`:

```cmd
npm run db:check
```

It runs only `SELECT VERSION()` and `SELECT 1`, reports the server version, and closes the pool. It does not create tables or run migrations. `npm start` uses the same local `.env`; `npm test` runs the backend's automated tests. The migration runner is a separate, explicit command and is never invoked by server startup. It requires a dedicated migration account; do not grant schema-changing privileges to `wellexsa_app`.

### Explicit local schema migration

The migration runner accepts MySQL 8.0.16 or later in the 8.0 series (including MySQL 8.0.42). Have the database administrator create a separate local migration account with only the privileges needed to create this schema and read/write the migration ledger (`CREATE`, `REFERENCES`, `SELECT`, `INSERT`, and `UPDATE` on `wellexsa.*`). For the local database, an administrator can run:

```sql
CREATE USER 'wellexsa_migrator'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
GRANT CREATE, REFERENCES, SELECT, INSERT, UPDATE ON wellexsa.* TO 'wellexsa_migrator'@'127.0.0.1';
SHOW GRANTS FOR 'wellexsa_migrator'@'127.0.0.1';
```

Save MySQL's generated password directly into the ignored `.env.migrations` file. Do not use the administrator account or the application account for migrations. Review any extra privilege needed before adding it.

In Command Prompt, create and edit the ignored migration-only environment file:

```cmd
cd /d C:\Users\COMP\Desktop\Wellexsa\server
copy .env.migrations.example .env.migrations
notepad .env.migrations
```

Set the migration account password in `.env.migrations` locally and keep that file out of source control. The migration runner uses the `MYSQL_MIGRATION_USER` and `MYSQL_MIGRATION_PASSWORD` variables, not the application credentials. Then explicitly confirm the exact database name:

```cmd
npm run db:migrate -- --confirm-database wellexsa
```

The runner verifies the MySQL version and the migration-ledger table structure, hashes each migration file with SHA-256, checks stored checksums and statuses, and refuses to continue for an empty pre-existing ledger, unknown, reordered, checksum-mismatched, `running`, or `failed` history. It also refuses to apply a pending migration if tables that migration intends to create already exist without history. A migration failure is recorded as `failed` when possible; an interrupted run remains `running`. Neither state is automatically retried because MySQL DDL may have partially committed. Stop and inspect the schema manually; never delete the ledger row to force a rerun.

The command applies files only from `database/migrations/`. It does not apply the reference seed or activate role grants. Do not run `database/tests/validation.sql` except against an explicitly disposable test database.

### Database role-permission matrix

The reference seed contains the following least-privilege grants, but it does not execute automatically and has not been applied to the database. Review it before explicitly running any seed command. The API resolves roles and grants from MySQL; verified Firebase token claims do not grant roles. Every assigned-scope permission must also be enforced with server-side ownership/assignment filters; a permission name alone is not an access boundary.

| Role | Proposed permissions |
| --- | --- |
| Owner | All CRM permissions: `crm.staff.read`, `crm.staff.manage`, `crm.roles.manage`, `crm.customers.read.assigned`, `crm.customers.read.all`, `crm.customers.create`, `crm.customers.update.assigned`, `crm.customers.update.all`, `crm.customers.archive`, `crm.customers.assign`, `crm.customer_links.review`, `crm.enquiries.read.assigned`, `crm.enquiries.read.all`, `crm.enquiries.update.assigned`, `crm.enquiries.update.all`, `crm.enquiries.assign`, `crm.contacts.log.assigned`, `crm.contacts.log.all`, `crm.followups.read.assigned`, `crm.followups.read.all`, `crm.followups.create.assigned`, `crm.followups.create.all`, `crm.followups.update.assigned`, `crm.followups.update.all`, `crm.followups.cancel`, `crm.sales.read.assigned`, `crm.sales.read.all`, `crm.sales.create`, `crm.sales.update.assigned`, `crm.sales.update.all`, `crm.sales.archive`, `catalog.read`, `catalog.manage`, `media.upload`, `media.manage`, `homepage_slides.manage`, `website_settings.manage`, `business_settings.manage`, `reports.read`, and `activity_logs.read`. |
| Staff | `crm.customers.read.assigned`, `crm.customers.create`, `crm.customers.update.assigned`, `crm.enquiries.read.assigned`, `crm.enquiries.update.assigned`, `crm.contacts.log.assigned`, `crm.followups.read.assigned`, `crm.followups.create.assigned`, `crm.followups.update.assigned`, `crm.followups.cancel`, `crm.sales.read.assigned`, `crm.sales.create`, and `catalog.read`. No access to all-record scopes, staff/role management, assignment, archives, or business settings by default. |
| Customer | `customer.profile.read.self`, `customer.profile.update.self`, and `customer.history.read.self` only. No CRM permission. |

User-level permission overrides cannot promote a Customer into CRM access or broaden Staff beyond the role allowlist. The server derives the role from the authenticated user record. The current API is unit-tested with mocks; because migrations and seeds remain unapplied and live MySQL integration is unverified, do not point existing CRM pages at it yet.

## Firebase project setup

1. Use the Firebase project currently configured in `js/firebase-config.js`, or create a new project if that configuration is not for the showroom's Firebase account.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Create a **Cloud Firestore** database in production mode.
4. Create a **Cloud Storage** bucket.
5. In **Project settings → General**, verify the Web App configuration in `js/firebase-config.js` against the intended project. If using a different project, replace the complete `firebaseConfig` object with its Web App values. Copy `storageBucket` exactly as Firebase shows it; bucket names can have different suffixes, so do not construct the value from the project ID. The web configuration is intended for public client apps; never put an Admin SDK private key in this file.
6. Install the Firebase CLI and sign in:

   ```powershell
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```

   Select the project created above. Deploy the Firestore and Storage rules from the project root:

   ```powershell
   firebase deploy --only firestore:rules,storage
   ```

7. Administrator access is temporarily disabled. Do not create or promote administrator accounts while this shutdown is in effect.
8. Deploy the Firestore indexes as well as both rulesets:

   ```powershell
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```

   In **Authentication → Settings → Authorized domains**, ensure `localhost` and the deployed hosting domain are allowed. Do not launch the app with permissive test rules.

### Authentication troubleshooting

The browser app reads its Firebase Web App settings only from `js/firebase-config.js`; its API key, `authDomain` and `projectId` must all come from the same existing Firebase project. In the Firebase and Google Cloud consoles, verify that Email/Password is enabled, the Firebase Authentication API is available to the project, the API key is allowed to call Identity Toolkit, and the site's hostname is an authorized domain. A `400` from `accounts:signUp` is an Authentication API response, not a Firestore profile-write error; the form reports common provider, API-key and domain errors separately.

If the browser reports `auth/configuration-not-found`, Firebase Authentication has not been initialized for the project selected by the Web API key. In Firebase Console, select the existing `wellexsa` project, open **Build → Authentication**, select **Get started** if prompted, then open **Sign-in method** and enable **Email/Password**. Do not change the app's API key to work around this error. The source files cannot initialize a Firebase project's backend service or verify its Console state.

### Legacy administrator access temporarily disabled

The admin pages, sign-in, password-change flow, privileged Functions, Firestore/Storage admin rules and local provisioning commands are disabled. Existing Auth users, custom claims, username mappings, bikes, historical orders and Storage objects are retained. Customer authentication and CRM access remain separate. Re-enabling admin access requires an intentional source change and deployment of the corresponding rules and Functions; do not enable only the client UI.

## Private Owner/Staff CRM

The CRM is separate from the disabled legacy admin system. It uses dedicated Owner/Staff pages at `crm/owner-login.html` and `crm/staff-login.html`; access is authorized by server-written `crmAccess/{uid}` records, checked by callable Functions and Firestore Rules. Customer-facing pages do not link to the CRM. The showroom catalogue uses Enquire Now; purchases are arranged directly with the showroom.

Website enquiries are submitted through the `crmSubmitBikeEnquiry` callable Function. The server validates the name and Indian mobile number, uses the existing hashed `crmPhoneIndex` in a transaction to link an existing customer or create one customer record, and stores each enquiry separately with a server timestamp and `new` status. Firestore Rules deny browser writes to both CRM collections and allow enquiry reads only to CRM users with `customers:view`; the Owner/Staff Enquiries tab displays the contact, bike, timestamp and new/existing match. The WhatsApp draft is offered only after the server confirms the save and requires the customer to send it manually.

The callable allows browser requests only from `http://localhost:5500` and `https://stunning-squirrel-b7fad7.netlify.app`. Run `npm run test:enquiry-cors` to check both OPTIONS preflights, a rejected origin and an actual callable-formatted submission against the local Functions and Firestore emulators (requires the Firebase CLI).

### Functions parameter: `ADMIN_AUTH_WEB_API_KEY`

`functions/index.js` declares `ADMIN_AUTH_WEB_API_KEY` as a Functions string parameter. The legacy administrator sign-in uses it as the Firebase Web API key for Firebase Authentication's `signInWithPassword` endpoint. Those administrator callables are currently disabled. This value is not a Firebase Admin SDK credential; never put a real project value in source code or documentation.

For local/demo emulator testing, Firebase CLI loads project-specific dotenv files from `functions/.env.<project-id>`. The CORS emulator test uses project `demo-wellexsa-cors`, so its parameter belongs in `functions/.env.demo-wellexsa-cors`. Use only a dummy test value for that demo configuration, for example:

```dotenv
ADMIN_AUTH_WEB_API_KEY=TEST_ONLY_DUMMY_VALUE
```

Do not use a production project's key for demo tests. The legacy administrator callables are disabled, so the demo value is not used to authenticate an account.

For Functions deployment, `ADMIN_AUTH_WEB_API_KEY` has no default. Provide it when the Firebase CLI prompts for the parameter, or configure it locally in `functions/.env.<target-project-id>` before deployment. If legacy administrator sign-in is intentionally re-enabled, configure the Web API key for the target Firebase project. Keep dotenv files out of source control; the repository ignores them and the Functions upload configuration excludes them.

The current source changes are not deployed. Before making the CRM available, review the security configuration and deploy the Functions, Firestore rules, indexes and static hosting files to the intended Firebase project. Never expose the Firebase Admin SDK credentials:

```powershell
npm install
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules,firestore:indexes,hosting
```

The root `firebase-admin` dependency is required only by trusted local provisioning and migration scripts; it must never be bundled into the browser.

The reported production site is hosted on Netlify. Deploy the Firebase Functions, rules and indexes with the Firebase CLI as above, and deploy the static site through the existing Netlify workflow. The Firebase Hosting command later in this README is only for projects that actually use Firebase Hosting. `_redirects` denies public requests to server source, provisioning scripts, Firebase rules/configuration and package metadata if the Netlify publish directory includes the repository root.

### Provision the first Owner

Enable **Email/Password** in Firebase Console under **Authentication → Sign-in method**. Add the local hostname (such as `127.0.0.1`) and deployed site hostname under **Authentication → Settings → Authorized domains**. The trusted provisioning script uses Application Default Credentials; authenticate locally with an authorized Google Cloud identity and never place service-account credentials in the repository:

```powershell
 npm install
gcloud auth application-default login
$env:GOOGLE_CLOUD_PROJECT = "wellexsa"
node scripts/provision-crm-owner.mjs
```

The script asks for the email and requires an exact typed confirmation before creating or promoting an existing account. For a new Auth account, it prompts for the password twice without echoing it; use a password with at least 12 characters. It creates the user and sets that new account's password through the Admin SDK, then writes the Owner record to `crmAccess/{uid}` using the actual Auth UID. Existing accounts keep their current passwords; the script does not reset them. Existing Staff accounts are never promoted without the exact `PROMOTE email` confirmation. A different active Owner blocks provisioning.

If the email is not verified, sign in once at the Owner page to receive the Firebase verification email, then verify before continuing. The access record requires a fresh authentication after its `minimumAuthTime`; sign out and sign in again after two seconds. The script does not print verification links, add custom claims or change Firestore Rules.

### Staff onboarding and access

Sign in at the Owner workspace and use **Staff access → Add staff**. Each staff member must use a dedicated new Firebase account; an existing Firebase account, including a public customer account, cannot be promoted into CRM access. A new account receives a password-setup email and must verify its email before CRM access is accepted. Only the Owner can change permissions, deactivate staff, reset access or reactivate a staff member. A reset/deactivation blocks current sessions via the live access record; reactivation requires a fresh sign-in.

### Existing customer-profile migration

The importer reads existing `users/{uid}` profiles and creates separate CRM lead/index records. It does not update or delete customer profiles, Auth users, historical orders, bikes or Storage objects. Invalid phones and phone collisions are queued for staff review and never silently linked.

Run the dry-run first; it performs no writes:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "YOUR_PROJECT_ID"
node scripts/migrate-crm-customers.mjs
```

Review the counts and confirm the selected project and duplicate handling before any write. To apply, set both variables to the exact intended project:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "YOUR_PROJECT_ID"
$env:CRM_MIGRATION_CONFIRM_PROJECT = "YOUR_PROJECT_ID"
node scripts/migrate-crm-customers.mjs --apply
```

Run migration only with a trusted operator identity in the intended Firebase project and after taking the project's normal backup. Do not run `--apply` against production until explicitly approved.

## Firestore data structure

### `bikes/{bikeId}`

Existing bike documents contain:

```text
name, price, model, brand, shortDescription, description,
batteryChemistry, range, batteryWarranty, motor, topSpeed,
batteryLife, chargingTime, loadCapacity, groundClearance, wheelbase,
paintFinish, keylessEntry, antiTheft, gpsTracking, appConnectivity, ipRating,
specifications: { "<custom specification>": "<value>" },
imageUrls: ["<Firebase Storage download URL>", ...],
imagePaths: ["bike-images/<bikeId>/<file>", ...],
stockQuantity: <non-negative integer>,
status: "published" | "draft" | "archived",
createdAt, updatedAt
```

The public website queries only `status == "published"`; published bikes with zero units show **OUT OF STOCK**. Privileged inventory reads and writes are disabled while admin access is paused. Existing documents and images are retained.

### WELLEXSA demonstration model previews

While live inventory is loading, if there are no published bikes, or if Firestore cannot be reached, the homepage displays eight clearly labeled demo models. A later live inventory snapshot replaces the previews. Their supplied specifications are sample data, prices and stock are unset, and their local JFIF images are demo imagery; verify the model, photograph and specifications before publishing actual inventory. Demo cards are for display only and do not create orders. This preview does not write to Firestore.

The prior admin-only demo model editor is unavailable while administrator access is paused. Public demo previews do not write to Firestore.

### Historical orders

Existing `orders/{orderId}` documents are retained. Customers may continue to read their own historical order records; client writes remain denied. This project no longer creates new website orders, and this source cleanup does not delete or migrate historical records.

Customer profiles are readable by their owner only. The administrator customer directory and its callable are unavailable while administrator access is paused.

### `homepageSlides/{slideId}` and `adminUsernames/{normalizedUsername}`

Homepage slides contain:

```text
title, description, buttonText, buttonUrl, imageUrl, imagePath,
order, enabled, active, status: "published" | "draft", createdAt, updatedAt
```

The public query filters on `status == "published"` and `enabled == true`, ordered by `order`. `adminUsernames` maps a normalized username to a Firebase Auth UID and is server-only; Firestore rules deny all client access to that collection. Homepage banner objects use `homepage-slides/{slideId}/{fileName}`. Admin slide editing and upload are unavailable while administrator access is paused.

If there are no enabled published slides, the homepage uses eight local model slides (Tunwal Alfa Pro, Tunwal Mini Lithino, Tunwal Sport 63, YO Bykes YO Smart+, YO Bykes YO Smart, YO Bykes YO DX, WELLEXSA Double Light and EoX Electric OKO) and cycles them every five seconds.

### Initial DECCAN R listing

The prior admin-only DECCAN R editor is unavailable while administrator access is paused. The original product photo remains intentionally unbundled because it was not supplied.

## Local testing

After verifying the Firebase Web App config and deploying Functions, indexes and rules, serve the project over HTTP from its root (opening the HTML as a `file:` URL does not support Firebase ES modules consistently):

```powershell
npm run lint:crm
npm run test:enquiry
python -m http.server 8000
```

`npm run lint:crm` checks JavaScript syntax for the CRM, enquiry and bike pages, setup scripts and Functions. `npm run test:enquiry` checks WhatsApp draft construction without sending a message or creating CRM data. This repository does not yet include automated Firebase Emulator Rules/Functions tests; do not treat syntax checks or a local static page load as authorization tests.

Open `http://localhost:8000` and test the authentication paths separately:

1. **Customer signup:** in a test Firebase project, open `signup.html`, submit a valid name, email, mobile number and matching password of at least 8 characters. Confirm the user appears in Firebase Authentication and a matching `users/{uid}` profile is created in Firestore. If the profile write fails after Auth creates the user, signup explains that the account already exists, resets the button, and provides a link to My Account to retry profile completion; do not submit signup again for that email.
2. **Customer login:** sign out, open `signin.html`, and sign in with that email and password. Normal sign-in returns to the homepage; only an explicit protected-page return such as `?return=account.html` resumes that page. Verify the shared profile icon opens the customer menu while signed in and Sign In / Create Account while logged out. Try a wrong password and verify the page displays a useful error without exposing credentials.
3. **Admin shutdown:** open each admin URL directly and confirm it returns the host's 404 or the local unavailable page, with no login/password forms or dashboard controls. Confirm the admin callables and rules deny privileged access after deploying the changes.
4. **Customer order history and enquiries:** confirm a customer can read only their own historical orders. Submit a product enquiry and verify it appears in the CRM; no website checkout or online order creation is available.

If signup returns `400`, confirm the Web App config belongs to the intended existing project, Email/Password is enabled, and the API key is not blocking Identity Toolkit. Then test protected account/order history and sign-out. Try publishing a bike with missing required fields, an invalid image type, and an image larger than 10 MB only after administrator access has been deliberately re-enabled. Confirm published catalogue prices/specifications and product enquiries remain available.

If local Python is unavailable, use any static HTTP server that serves this folder without changing the project's Firebase access rules.

## Deploy the website

After Firebase setup and local authentication, enquiry and CRM smoke tests:

```powershell
firebase deploy --only hosting,firestore:rules,storage,functions
```

Firebase Hosting serves the static HTML/CSS/JavaScript. Firebase Authentication, Firestore and Storage are the backend. The hosting configuration excludes the setup script, package files and security-rules source files from the hosted site.

## Security and operations

- Firestore and Storage admin access is currently hard-disabled by the rules; hiding pages is not the security boundary.
- Historical `orders` are read-only to website clients. Existing order and customer records are retained; CRM purchase tracking records showroom sales separately.
- Existing inventory counts and order data remain stored in Firestore while the admin dashboard is unavailable.
- Customer accounts are regular Firebase Authentication users and cannot grant themselves admin claims.
- Do not commit credentials, private keys or `.env` files.
- Firebase Storage download URLs are bearer-token URLs. Public pages continue to use published product images. Do not delete stored images during the temporary admin shutdown.
- The supplied showroom logo is preserved at `assets/images/wellexsa-logo.png`. Branch direction links use only the branch descriptions provided and do not assume map coordinates; confirm the actual Google Maps pins before relying on them for customer navigation.
- Phone, branch-specific WhatsApp links, showroom addresses, directions links and a site-wide WhatsApp enquiry action are included on the public site. No third-party lead-storage service is assumed.
- Set Firebase Authentication authorized domains and applicable billing/usage alerts in the Firebase console before launch. The Firebase web API key is public; enforce access in Firebase rules and provider settings.
