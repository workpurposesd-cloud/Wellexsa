# WELLEXSA MOTORS

A responsive electric-scooter showroom with customer accounts, live Firestore listings, Firebase Storage image uploads and a separately authorized administrator dashboard.

## Brand and design assets

- The supplied WELLEXSA emblem and wordmark PNG is used as the logo throughout the website without recreating the artwork. Its white artwork is placed against a charcoal background for legibility.
- The homepage slider uses eight local fallback slides; enabled, published Firestore slides override them. The eight active demo previews use the original `assets/images/image1.jfif` through `image8.jfif` files, mapped in order to Tunwal Alfa Pro, Tunwal Mini Lithino, Tunwal Sport 63, YO Bykes YO Smart+, YO Bykes YO Smart, YO Bykes YO DX, WELLEXSA Double Light and EoX Electric OKO. The image9.jfif and image10.jfif files are retained but are not used in the active demo catalogue.
- `privacy.html` and `terms.html` are starter pages, clearly marked for showroom business review. Confirm the final legal, data-retention, cancellation, delivery and warranty terms before launch.

## What is included

- Public showroom with live, published-only listings, scooter detail pages and showroom contact links.
- Homepage slideshow managed from the administrator dashboard. Banner images are uploaded to Firebase Storage; only enabled, published slides are queried publicly.
- Firebase customer signup, sign-in, account page and sign-out.
- Separate username-based admin sign-in, first-login password change and dashboard. The username mapping stays server-only; access is verified from Firebase custom claims and enforced by Firestore and Storage rules.
- Admin bike create, edit, publish, unpublish, stock adjustment and archive workflows. Archiving hides a bike and zeroes active stock without deleting historical order snapshots.
- Stock-aware shopping cart and checkout. Customers can choose a supported battery/range combination on the product details page; the trusted backend validates that choice against the published product specifications, recalculates the product listing price, and checks aggregate stock.
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

### Authentication troubleshooting

The browser app reads its Firebase Web App settings only from `js/firebase-config.js`; its API key, `authDomain` and `projectId` must all come from the same existing Firebase project. The admin callable's `FIREBASE_WEB_API_KEY` parameter must match that Web App API key. In the Firebase and Google Cloud consoles, verify that Email/Password is enabled, the Firebase Authentication API is available to the project, the API key is allowed to call Identity Toolkit, and the site's hostname is an authorized domain. A `400` from `accounts:signUp` is an Authentication API response, not a Firestore profile-write error; the form reports common provider, API-key and domain errors separately.

If the browser reports `auth/configuration-not-found`, Firebase Authentication has not been initialized for the project selected by the Web API key. In Firebase Console, select the existing `wellexsa` project, open **Build → Authentication**, select **Get started** if prompted, then open **Sign-in method** and enable **Email/Password**. Do not change the app's API key to work around this error. The source files cannot initialize a Firebase project's backend service or verify its Console state.

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

While live inventory is loading, if there are no published bikes, or if Firestore cannot be reached, the homepage displays eight clearly labeled demo models. A later live inventory snapshot replaces the previews. Their supplied specifications are sample data, prices and stock are unset, and their local JFIF images are demo imagery; verify the model, photograph and specifications before publishing actual inventory. Demo cards cannot be added to the cart. This preview does not write to Firestore.

An authorized administrator can choose **Start from a WELLEXSA demo model** in the bike editor to prefill the existing form. This only loads editable values in the form; it does not create a Firestore document. Verify all specifications, enter a real price and warranty, set inventory, and upload a real product photo before publishing. The existing `bikes` collection and Firestore validation remain unchanged.

### `orders/{orderId}`

Orders are written and updated by trusted Cloud Functions only:

```text
userId, customer: { name, email, phone }, shipping: { name, phone, address, city, state, postalCode },
items: [{ bikeId, name, brand, model, imageUrl, quantity, unitPrice, lineTotal, batteryOption?: { batteryType, range, warranty } }],
totalAmount (INR), currency, paymentStatus, orderStatus, razorpayOrderId,
razorpayPaymentId, paymentCapturedAt, refundId/refundStatus, createdAt, updatedAt
```

Customers may read only their own orders; admins may read orders for support. `paymentStatus` is controlled by payment verification/webhooks and is never editable from the admin UI. `orderStatus` tracks fulfillment separately. The backend checks selected battery/range options and aggregate stock at checkout and again in a Firestore transaction after confirmed capture; duplicate webhook/callback processing does not deduct stock twice. If a paid payment cannot be fulfilled because stock changed concurrently, the order is flagged for admin review/refund rather than overselling.

### `checkoutRequests/{uid_requestId}` and `paymentIssues/{issueId}`

These are private backend operational records. Direct client access is denied. Historical product names, quantities and prices are snapshotted in each order; archiving a product does not delete orders.

### `homepageSlides/{slideId}` and `adminUsernames/{normalizedUsername}`

Homepage slides contain:

```text
title, description, buttonText, buttonUrl, imageUrl, imagePath,
order, enabled, active, status: "published" | "draft", createdAt, updatedAt
```

The public query filters on `status == "published"` and `enabled == true`, ordered by `order`. The admin-selected starting slide is shown first, then the remaining slides rotate every five seconds. `adminUsernames` maps a normalized username to a Firebase Auth UID and is server-only; Firestore rules deny all client access to that collection. Homepage banner objects use `homepage-slides/{slideId}/{fileName}` and the same 10 MB JPG/PNG/WebP restrictions as bike images.

If there are no enabled published slides, the homepage uses eight local model slides (Tunwal Alfa Pro, Tunwal Mini Lithino, Tunwal Sport 63, YO Bykes YO Smart+, YO Bykes YO Smart, YO Bykes YO DX, WELLEXSA Double Light and EoX Electric OKO) and cycles them every five seconds.

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

Open `http://localhost:8000` and test the authentication paths separately:

1. **Customer signup:** open `signup.html`, submit a valid name, email, mobile number and matching password of at least 8 characters. Confirm the user appears in Firebase Authentication, a matching `users/{uid}` profile is created in Firestore, and signup returns to the homepage with a success notice. If profile persistence fails after Auth creates the user, signup remains successful; check the browser console and Firestore rules/connection for the profile-write error.
2. **Customer login:** sign out, open `signin.html`, and sign in with that email and password. Normal sign-in returns to the homepage; only an explicit protected-page return such as `?return=account.html` or `?return=checkout.html` resumes that page. Verify the navigation shows the profile menu while signed in and Login / Sign Up after logout. Try a wrong password and verify the page displays a useful error without exposing credentials.
3. **Admin login:** provision the administrator with the trusted setup above, then use its username and password at `admin-login.html`. First sign-in must redirect to `admin-change-password.html`; after setting the required new password, subsequent sign-in should reach `admin-dashboard.html`. A normal customer account must not pass the dashboard's custom-claim check.

If signup returns `400`, confirm the Web App config belongs to the intended existing project, Email/Password is enabled, and the API key is not blocking Identity Toolkit. For admin sign-in, also confirm the `FIREBASE_WEB_API_KEY` Functions parameter matches the Web App key and the admin callable functions are deployed. Then test protected account/order history and sign-out. Try publishing a bike with missing required fields, an invalid image type, and an image larger than 10 MB. Set stock to 10, add to cart, test quantity limits, and check out in Razorpay test mode. Verify failed/cancelled payments do not reduce stock, a verified successful payment reduces it once, zero stock disables purchase, and repeated webhook delivery does not double-deduct. Try order filtering/status updates and confirm the admin UI cannot set a payment to successful.

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
