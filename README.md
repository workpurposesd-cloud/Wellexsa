# WELLEXSA MOTORS

A responsive electric-scooter showroom with customer accounts, live Firestore listings, Firebase Storage image uploads and a separately authorized administrator dashboard.

## Brand and design assets

- The supplied WELLEXSA emblem and wordmark PNG is used as the logo throughout the website without recreating the artwork. Its white artwork is placed against a charcoal background for legibility.
- The homepage hero uses the main image from the newest published bike listing. Upload a genuine showroom/product photograph when publishing inventory; the project does not use a generated scooter illustration as a product photo.
- `privacy.html` and `terms.html` are starter pages, clearly marked for showroom business review. Confirm the final legal, data-retention, cancellation, delivery and warranty terms before launch.

## What is included

- Public showroom with live, published-only listings, scooter detail pages and showroom contact links.
- Homepage slideshow managed from the administrator dashboard. Banner images are uploaded to Firebase Storage; only enabled, published slides are queried publicly.
- Firebase customer signup, sign-in, account page and sign-out.
- Separate username-based admin sign-in, first-login password change and dashboard. The username mapping stays server-only; access is verified from Firebase custom claims and enforced by Firestore and Storage rules.
- Admin bike create, edit, publish, unpublish, stock adjustment and archive workflows. Archiving hides a bike and zeroes active stock without deleting historical order snapshots.
- Stock-aware shopping cart and checkout. Checkout prices and available inventory are recalculated by the trusted backend.
- Firebase Cloud Functions create Razorpay orders, verify payment signatures and gateway status, handle Razorpay webhooks and atomically deduct stock only once after a captured payment.
- Customer order history and admin order/payment/customer views. Fulfillment status is separated from payment status; admins cannot mark a payment as paid.
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

7. Copy the Web App API key into the Functions parameter `FIREBASE_WEB_API_KEY` when the Firebase CLI asks for it on the first Functions deployment. This is the same public Web App key, not an Admin SDK credential.
8. Create the initial administrator with the trusted setup below. Choose an email address controlled by the showroom; the requested username is provisioned separately and customer signup cannot grant admin access.
9. Deploy the Firestore indexes as well as both rulesets:

   ```powershell
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```

   In **Authentication → Settings → Authorized domains**, ensure `localhost` and the deployed hosting domain are allowed. Do not launch the app with permissive test rules.

### Provision the initial administrator (trusted setup)

The provisioning helper creates or updates the Firebase Auth account, assigns the requested username mapping, grants the admin claim and requires a password change on first sign-in. It runs only on a trusted operator's computer; it is not part of the hosted website. The password is prompted without terminal echo and is never written to source files.

1. Install Node.js and the Google Cloud CLI. In this project folder, run `npm install`.
2. In Google Cloud Console, enable the Firebase Authentication API for the Firebase project's Google Cloud project.
3. Set up Application Default Credentials for a trusted operator who has permission to manage Firebase Authentication, for example:

   ```powershell
   gcloud auth application-default login
   $env:GOOGLE_CLOUD_PROJECT = "YOUR_PROJECT_ID"
   ```

   The operator also needs permission to manage Cloud Firestore. Keep all service-account keys outside the website and source-control directory; never upload or commit them.
4. Provision the admin using the business-controlled email and the requested username:

   ```powershell
   npm run provision-admin -- admin@example.com Ummala
   ```

   Enter the temporary password when prompted. On first username sign-in, the dashboard is blocked until the administrator chooses a new password of at least 12 characters. Never put either password in website files, shell command arguments, or Firestore. To revoke access, use a trusted Admin SDK call to remove the `admin` claim and delete the matching `adminUsernames/{normalizedUsername}` mapping.

The admin login callable verifies the username mapping and checks the submitted password against Firebase Authentication over the Identity Toolkit API before minting a short-lived Firebase custom sign-in token. It returns a generic error for unknown usernames and incorrect passwords. `FIREBASE_WEB_API_KEY` is a public Firebase Web App API key; security still depends on the deployed rules and admin claims.

### Deploy admin login Functions

The first deployment prompts for the `FIREBASE_WEB_API_KEY` string parameter. Supply the same key copied from the Web App configuration. Deploy the username login and required password-change functions:

```powershell
firebase deploy --only functions:adminSignInWithUsername,functions:completeAdminPasswordChange --project wellexsa
```

Deploy other payment Functions only after completing the separate Razorpay setup and secret configuration below.

## Firestore data structure

### `bikes/{bikeId}`

Admin-created bike documents contain:

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

The five required specifications, non-negative quantity and at least one bike image are validated before publish and by Firestore/Storage authorization. The public website queries only `status == "published"`; published bikes with zero units show **OUT OF STOCK** and cannot be added to a cart. Drafts and archived bike documents are readable only by admins. Deleting from active inventory uses archive semantics so existing order snapshots remain intact.

### WELLEXSA demonstration model previews

While live inventory is loading, if there are no published bikes, or if Firestore cannot be reached, the homepage displays ten clearly labeled WELLEXSA concept models. A later live inventory snapshot replaces the previews. Their supplied specifications are demonstration data, prices and stock are unset, and their local SVG artwork is illustrative rather than product photography. Demo cards cannot be added to the cart. This preview does not write to Firestore.

An authorized administrator can choose **Start from a WELLEXSA demo model** in the bike editor to prefill the existing form. This only loads editable values in the form; it does not create a Firestore document. Verify all specifications, enter a real price and warranty, set inventory, and upload a real product photo before publishing. The existing `bikes` collection and Firestore validation remain unchanged.

### `orders/{orderId}`

Orders are written and updated by trusted Cloud Functions only:

```text
userId, customer: { name, email, phone }, shipping: { name, phone, address, city, state, postalCode },
items: [{ bikeId, name, brand, model, imageUrl, quantity, unitPrice, lineTotal }],
totalAmount (INR), currency, paymentStatus, orderStatus, razorpayOrderId,
razorpayPaymentId, paymentCapturedAt, refundId/refundStatus, createdAt, updatedAt
```

Customers may read only their own orders; admins may read orders for support. `paymentStatus` is controlled by payment verification/webhooks and is never editable from the admin UI. `orderStatus` tracks fulfillment separately. The backend checks stock at checkout and again in a Firestore transaction after confirmed capture; duplicate webhook/callback processing does not deduct stock twice. If a paid payment cannot be fulfilled because stock changed concurrently, the order is flagged for admin review/refund rather than overselling.

### `checkoutRequests/{uid_requestId}` and `paymentIssues/{issueId}`

These are private backend operational records. Direct client access is denied. Historical product names, quantities and prices are snapshotted in each order; archiving a product does not delete orders.

### `homepageSlides/{slideId}` and `adminUsernames/{normalizedUsername}`

Homepage slides contain:

```text
title, description, buttonText, buttonUrl, imageUrl, imagePath,
order, enabled, active, status: "published" | "draft", createdAt, updatedAt
```

The public query filters on `status == "published"` and `enabled == true`, ordered by `order`. The admin-selected starting slide is shown first, then the remaining slides rotate every five seconds. `adminUsernames` maps a normalized username to a Firebase Auth UID and is server-only; Firestore rules deny all client access to that collection. Homepage banner objects use `homepage-slides/{slideId}/{fileName}` and the same 10 MB JPG/PNG/WebP restrictions as bike images.

### Initial DECCAN R listing

In the admin dashboard, choose **Add new bike → Use DECCAN R details**, upload the original DECCAN R three-angle image as the main photo (optional gallery photos can be added), review the prefilled details, and click the single **SAVE & PUBLISH BIKE** action. Publishing writes a normal Firestore listing and it appears on the public homepage automatically. The image is intentionally not fabricated or bundled because the original product photo was not supplied.

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

After updating the Firebase Web App config, setting the Functions API-key parameter, deploying Functions, indexes and rules, serve the project over HTTP from its root (opening the HTML as a `file:` URL does not support Firebase ES modules consistently):

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. Test customer registration, sign-in, protected account/order history and sign-out; then sign in at `http://localhost:8000/admin-login.html` with the provisioned username and password. The associated Firebase Auth account must have the `admin: true` custom claim. Try publishing a bike with missing required fields, an invalid image type, and an image larger than 10 MB. Set stock to 10, add to cart, test quantity limits, and check out in Razorpay test mode. Verify failed/cancelled payments do not reduce stock, a verified successful payment reduces it once, zero stock disables purchase, and repeated webhook delivery does not double-deduct. Try order filtering/status updates and confirm the admin UI cannot set a payment to successful.

If local Python is unavailable, use any static HTTP server that serves this folder without changing the project's Firebase access rules.

## Deploy the website

After Firebase setup, Razorpay test-mode webhook setup and a local smoke test:

```powershell
firebase deploy --only hosting,firestore:rules,storage,functions
```

Firebase Hosting serves the static HTML/CSS/JavaScript. Firebase Authentication, Firestore and Storage are the backend. The hosting configuration excludes the setup script, package files and security-rules source files from the hosted site.

## Security and operations

- Firestore and Storage writes require the trusted `admin: true` custom claim; hiding dashboard UI is not the security boundary.
- `orders`, `checkoutRequests` and payment operational data are not client-writable. Payment creation and verification, webhook processing, stock deduction, refund requests and order fulfillment changes go through callable/HTTP Cloud Functions.
- The Razorpay webhook is signature-checked against the raw request body. The browser success handler also calls a server verification routine; neither the frontend nor an admin control can directly mark payment as successful.
- Inventory counts and low-stock alerts in the admin dashboard are derived from Firestore. Configure a stock threshold appropriate for the showroom before operational use; the current dashboard warning threshold is 3 units.
- Customer accounts are regular Firebase Authentication users and cannot grant themselves admin claims.
- Do not commit credentials, private keys or `.env` files.
- Firebase Storage download URLs are bearer-token URLs. Only administrators can upload; website pages obtain images for published bikes. If an image must become inaccessible after unpublishing, revoke its download token or delete that image in Firebase Storage as part of the unpublish process.
- The supplied showroom logo is preserved at `assets/images/wellexsa-logo.png`. Branch direction links use only the branch descriptions provided and do not assume map coordinates; confirm the actual Google Maps pins before relying on them for customer navigation.
- Phone, branch-specific WhatsApp links, showroom addresses, directions links and a site-wide WhatsApp enquiry action are included on the public site. No third-party lead-storage service is assumed.
- Set Firebase Authentication authorized domains and applicable billing/usage alerts in the Firebase console before launch. The Firebase web API key is public; enforce access in Firebase rules and provider settings.
