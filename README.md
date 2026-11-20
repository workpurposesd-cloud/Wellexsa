# WELLEXSA MOTORS

A responsive electric-scooter showroom with customer accounts, live Firestore listings and Firebase Storage images. Administrator pages, provisioning and privileged access are temporarily disabled; existing Firebase data is retained.

## Brand and design assets

- The supplied WELLEXSA emblem and wordmark PNG is used as the logo throughout the website without recreating the artwork. Its white artwork is placed against a charcoal background for legibility.
- The homepage slider uses eight local fallback slides; enabled, published Firestore slides override them. The eight active demo previews use the original `assets/images/image1.jfif` through `image8.jfif` files, mapped in order to Tunwal Alfa Pro, Tunwal Mini Lithino, Tunwal Sport 63, YO Bykes YO Smart+, YO Bykes YO Smart, YO Bykes YO DX, WELLEXSA Double Light and EoX Electric OKO. The image9.jfif and image10.jfif files are retained but are not used in the active demo catalogue.
- `privacy.html` and `terms.html` are starter pages, clearly marked for showroom business review. Confirm the final legal, data-retention, cancellation, delivery and warranty terms before launch.

## What is included

- Public showroom with live, published-only listings, scooter detail pages and showroom contact links.
- Enabled, published homepage slides remain visible to customers. Administrator slide management is temporarily unavailable.
- Firebase customer signup, sign-in, account page and sign-out.
- Administrator sign-in, dashboard and provisioning are temporarily disabled. Existing admin accounts and records are not deleted.
- A separate, private Owner/Staff CRM is implemented under `crm/`; it uses server-checked `crmAccess` records and does not restore legacy administrator claims or admin pages. It is not available on the live site until its Functions, Firestore rules, indexes and hosting assets are deliberately deployed.
- Existing published bikes and customer purchases remain available; privileged inventory changes are temporarily unavailable.
- Stock-aware shopping cart and checkout. Customers can choose a supported battery/range combination on the product details page; the trusted backend validates that choice against the published product specifications, recalculates the product listing price, and checks aggregate stock.
- Firebase Cloud Functions create Razorpay orders, verify payment signatures and gateway status, handle Razorpay webhooks and atomically deduct stock only once after a captured payment.
- Customer order history remains available to each customer. Administrator order/payment/customer views are temporarily unavailable.
- The **SAVE & PUBLISH BIKE** workflow requires a main image, price, name and the five required specifications. Optional fields do not block publishing.
- **Use DECCAN R details** fills the requested DECCAN R – RAYA FLUX information into the form. Add the showroom's original three-angle product photo before publishing; the original photo was not included in this project, so the website does not substitute an invented DECCAN R image.
- Firebase Web App configuration is populated for project `wellexsa`; confirm it is the showroom's intended Firebase project before deploying. No Firebase service-account credentials or demonstration logins are included.
- Cart contents are kept in the customer's browser for convenience; prices, stock, payment and orders are always verified and stored server-side.

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

The admin pages, sign-in, password-change flow, privileged Functions, Firestore/Storage admin rules and local provisioning commands are disabled. Existing Auth users, custom claims, username mappings, bikes, orders, payments and Storage objects are retained. The public customer and Razorpay payment flows remain separate. Re-enabling admin access requires an intentional source change and deployment of the corresponding rules and Functions; do not enable only the client UI.

## Private Owner/Staff CRM

The CRM is separate from the disabled legacy admin system. It uses dedicated Owner/Staff pages at `crm/owner-login.html` and `crm/staff-login.html`; access is authorized by server-written `crmAccess/{uid}` records, checked by callable Functions and Firestore Rules. Customer-facing pages do not link to the CRM. Customer authentication and Razorpay remain separate. The showroom catalogue now uses Enquire Now instead of cart and checkout actions; the existing cart and checkout implementation remains in the repository but is no longer linked from the bike shopping flow.

Website enquiries are submitted through the `crmSubmitBikeEnquiry` callable Function. The server validates the name and Indian mobile number, uses the existing hashed `crmPhoneIndex` in a transaction to link an existing customer or create one customer record, and stores each enquiry separately with a server timestamp and `new` status. Firestore Rules deny browser writes to both CRM collections and allow enquiry reads only to CRM users with `customers:view`; the Owner/Staff Enquiries tab displays the contact, bike, timestamp and new/existing match. The WhatsApp draft is offered only after the server confirms the save and requires the customer to send it manually.

The callable allows browser requests only from `http://localhost:5500` and `https://stunning-squirrel-b7fad7.netlify.app`. Run `npm run test:enquiry-cors` to check both OPTIONS preflights, a rejected origin and an actual callable-formatted submission against the local Functions and Firestore emulators (requires the Firebase CLI).

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

Use an existing, verified Firebase Authentication account and trusted Application Default Credentials. This operation creates only the CRM role record; it does not set a password, custom claim or legacy admin role.

```powershell
$env:GOOGLE_CLOUD_PROJECT = "YOUR_PROJECT_ID"
node scripts/provision-crm-owner.mjs owner@example.com --confirm-owner=owner@example.com
```

The Owner record requires a new sign-in after the minimum session time shown by the script. Keep the CRM owner login URL private and use an organization-managed email account.

### Staff onboarding and access

Sign in at the Owner workspace and use **Staff access → Add staff**. Each staff member must use a dedicated new Firebase account; an existing Firebase account, including a public customer account, cannot be promoted into CRM access. A new account receives a password-setup email and must verify its email before CRM access is accepted. Only the Owner can change permissions, deactivate staff, reset access or reactivate a staff member. A reset/deactivation blocks current sessions via the live access record; reactivation requires a fresh sign-in.

### Existing customer-profile migration

The importer reads existing `users/{uid}` profiles and creates separate CRM lead/index records. It does not update or delete customer profiles, Auth users, orders, bikes, payments or Storage objects. Invalid phones and phone collisions are queued for staff review and never silently linked.

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

The public website queries only `status == "published"`; published bikes with zero units show **OUT OF STOCK** and cannot be added to a cart. Privileged inventory reads and writes are disabled while admin access is paused. Existing documents and images are retained.

### WELLEXSA demonstration model previews

While live inventory is loading, if there are no published bikes, or if Firestore cannot be reached, the homepage displays eight clearly labeled demo models. A later live inventory snapshot replaces the previews. Their supplied specifications are sample data, prices and stock are unset, and their local JFIF images are demo imagery; verify the model, photograph and specifications before publishing actual inventory. Demo cards cannot be added to the cart. This preview does not write to Firestore.

The prior admin-only demo model editor is unavailable while administrator access is paused. Public demo previews do not write to Firestore.

### `orders/{orderId}`

Orders are written and updated by trusted Cloud Functions only:

```text
userId, customer: { name, email, phone }, shipping: { name, phone, address, city, state, postalCode },
items: [{ bikeId, name, brand, model, imageUrl, quantity, unitPrice, lineTotal, batteryOption?: { batteryType, range, warranty } }],
totalAmount (INR), currency, paymentStatus, orderStatus, razorpayOrderId,
razorpayPaymentId, paymentCapturedAt, refundId/refundStatus, createdAt, updatedAt
```

Customers may read only their own orders; direct client writes are denied. `paymentStatus` is controlled by payment verification/webhooks. `orderStatus` tracks fulfillment separately. The backend checks selected battery/range options and aggregate stock at checkout and again in a Firestore transaction after confirmed capture; duplicate webhook/callback processing does not deduct stock twice. Admin order review and refunds are unavailable while administrator access is paused.

Customer profiles are readable by their owner only. The administrator customer directory and its callable are unavailable while administrator access is paused.

### `checkoutRequests/{uid_requestId}` and `paymentIssues/{issueId}`

These are private backend operational records. Direct client access is denied. Historical product names, quantities and prices are snapshotted in each order; archiving a product does not delete orders.

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

## Razorpay and secure payment setup

1. Create/verify the merchant account in Razorpay and begin in **Test Mode**. Obtain the test Key ID and Key Secret from the Razorpay Dashboard.
2. Set backend credentials from a trusted project operator; these values are stored as Firebase Functions secrets, not frontend files:

   ```powershell
   firebase functions:secrets:set RAZORPAY_KEY_SECRET
   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
   ```

   Use the Razorpay test-mode Key Secret and a separately generated webhook secret. Keep both out of source control and chat.
3. During the first Functions deployment, provide `RAZORPAY_KEY_ID` as the test key and `RAZORPAY_MODE` as `test` when prompted for the declared function parameters. The backend rejects a key whose `rzp_test_` / `rzp_live_` prefix disagrees with the configured mode.
4. Deploy Functions, then register a Razorpay webhook in the merchant dashboard using:

   ```text
   https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/razorpayWebhook
   ```

   Select `payment.captured`, `payment.failed`, and `refund.processed`; paste the exact webhook secret set above. Confirm the deployed region/project URL in Firebase before saving it.
5. Test successful, failed and dismissed checkout flows in Razorpay Test Mode. Confirm the server-side signature/API check and webhook update the order, then confirm stock changes once only for a verified capture. Never treat a browser callback alone as proof of payment.
6. Live mode remains disabled until the merchant account is verified and production testing is complete. Only then set the live Key ID/Key Secret and production webhook secret through Firebase secret/parameter configuration, set `RAZORPAY_MODE` to `live`, redeploy Functions and replace the webhook endpoint. Do not place a live Key Secret in frontend code. Payment integration is not live merely because these source files exist.

UPI, eligible cards and net banking are presented by Razorpay Checkout according to the merchant account, customer eligibility and Razorpay configuration. This website never collects or stores card number, CVV or payment credentials.

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
2. **Customer login:** sign out, open `signin.html`, and sign in with that email and password. Normal sign-in returns to the homepage; only an explicit protected-page return such as `?return=account.html` or `?return=checkout.html` resumes that page. Verify the shared profile icon opens the customer menu while signed in and Sign In / Create Account while logged out. Try a wrong password and verify the page displays a useful error without exposing credentials.
3. **Admin shutdown:** open each admin URL directly and confirm it returns the host's 404 or the local unavailable page, with no login/password forms or dashboard controls. Confirm the admin callables and rules deny privileged access after deploying the changes.
4. **Customer orders:** sign in as a customer and confirm only that customer's order history is available; verify product browsing, cart, checkout and payment behavior remain separate from admin access.

If signup returns `400`, confirm the Web App config belongs to the intended existing project, Email/Password is enabled, and the API key is not blocking Identity Toolkit. Then test protected account/order history and sign-out. Try publishing a bike with missing required fields, an invalid image type, and an image larger than 10 MB only after administrator access has been deliberately re-enabled. Set stock to 10, add to cart, test quantity limits, and check out in Razorpay test mode. Verify failed/cancelled payments do not reduce stock, a verified successful payment reduces it once, zero stock disables purchase, and repeated webhook delivery does not double-deduct.

If local Python is unavailable, use any static HTTP server that serves this folder without changing the project's Firebase access rules.

## Deploy the website

After Firebase setup, Razorpay test-mode webhook setup and a local smoke test:

```powershell
firebase deploy --only hosting,firestore:rules,storage,functions
```

Firebase Hosting serves the static HTML/CSS/JavaScript. Firebase Authentication, Firestore and Storage are the backend. The hosting configuration excludes the setup script, package files and security-rules source files from the hosted site.

## Security and operations

- Firestore and Storage admin access is currently hard-disabled by the rules; hiding pages is not the security boundary.
- `orders`, `checkoutRequests` and payment operational data are not client-writable. Payment creation and verification, webhook processing, stock deduction, refund requests and order fulfillment changes go through callable/HTTP Cloud Functions.
- The Razorpay webhook is signature-checked against the raw request body. The browser success handler also calls a server verification routine; neither the frontend nor an admin control can directly mark payment as successful.
- Existing inventory counts and order data remain stored in Firestore while the admin dashboard is unavailable.
- Customer accounts are regular Firebase Authentication users and cannot grant themselves admin claims.
- Do not commit credentials, private keys or `.env` files.
- Firebase Storage download URLs are bearer-token URLs. Public pages continue to use published product images. Do not delete stored images during the temporary admin shutdown.
- The supplied showroom logo is preserved at `assets/images/wellexsa-logo.png`. Branch direction links use only the branch descriptions provided and do not assume map coordinates; confirm the actual Google Maps pins before relying on them for customer navigation.
- Phone, branch-specific WhatsApp links, showroom addresses, directions links and a site-wide WhatsApp enquiry action are included on the public site. No third-party lead-storage service is assumed.
- Set Firebase Authentication authorized domains and applicable billing/usage alerts in the Firebase console before launch. The Firebase web API key is public; enforce access in Firebase rules and provider settings.
