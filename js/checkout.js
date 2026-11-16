import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { formatPrice, getBatteryRangeOptions, readCart } from "./bikes.js";

const form = document.getElementById("checkout-form");
const message = document.getElementById("checkout-message");
const payButton = document.getElementById("pay-button");
const functions = isFirebaseConfigured ? getFunctions() : null;
let currentUser = null;
let checkoutRequestId = sessionStorage.getItem("wellexsa-checkout-request-id") || "";

async function loadCartTotal() {
  if (!isFirebaseConfigured) {
    message.textContent = "Firebase must be configured before secure checkout is available.";
    return;
  }
  const cart = readCart();
  if (!cart.length) {
    window.location.replace("cart.html");
    return;
  }
  try {
    let total = 0;
    const summary = document.getElementById("checkout-items");
    const summaryRows = [];
    const quantitiesByBike = new Map();
    cart.forEach((item) => {
      quantitiesByBike.set(item.bikeId, (quantitiesByBike.get(item.bikeId) || 0) + item.quantity);
    });
    for (const item of cart) {
      const snapshot = await getDoc(doc(db, "bikes", item.bikeId));
      if (!snapshot.exists()) throw new Error("A scooter in your cart is no longer available.");
      const bike = snapshot.data();
      if (bike.status !== "published" || !Number.isInteger(bike.stockQuantity) ||
          bike.stockQuantity < quantitiesByBike.get(item.bikeId)) {
        throw new Error(`${bike.name} does not have enough stock for this quantity.`);
      }
      if (!Number.isSafeInteger(bike.price) || bike.price <= 0) {
        throw new Error(`${bike.name} does not have a valid listed price.`);
      }
      const options = getBatteryRangeOptions(bike);
      const selectedOption = options.find((option) =>
        option.batteryType === item.batteryOption?.batteryType && option.range === item.batteryOption?.range
      );
      if (options.length && !selectedOption) {
        throw new Error(`Choose an available battery and range for ${bike.name} from its product details page.`);
      }
      if (!options.length && item.batteryOption) {
        throw new Error(`The battery / range selection for ${bike.name} is no longer available.`);
      }
      total += bike.price * item.quantity;
      summaryRows.push({
        name: bike.name,
        quantity: item.quantity,
        lineTotal: bike.price * item.quantity,
        batterySelection: selectedOption
          ? `${selectedOption.batteryType} · ${selectedOption.range} · ${selectedOption.warranty} warranty`
          : ""
      });
    }
    summary.replaceChildren();
    for (const item of summaryRows) {
      const row = document.createElement("div");
      row.className = "checkout-summary-row";
      const name = document.createElement("span");
      name.textContent = `${item.name} × ${item.quantity}`;
      const description = document.createElement("div");
      description.append(name);
      const amount = document.createElement("strong");
      amount.textContent = formatPrice(item.lineTotal);
      if (item.batterySelection) {
        const selection = document.createElement("small");
        selection.textContent = item.batterySelection;
        description.append(selection);
      }
      row.append(description, amount);
      summary.append(row);
    }
    document.getElementById("checkout-total").textContent = formatPrice(total);
    payButton.disabled = false;
  } catch (error) {
    message.textContent = error.message || "Cart availability could not be checked.";
    payButton.disabled = true;
  }
}

if (!isFirebaseConfigured) {
  document.getElementById("checkout-total").textContent = "Unavailable";
  message.textContent = "Firebase must be configured before secure checkout is available.";
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("signin.html?return=checkout.html");
      return;
    }
    currentUser = user;
    form.elements.name.value = user.displayName || "";
    form.elements.email.value = user.email || "";
    loadCartTotal();
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isFirebaseConfigured || !currentUser || !form.reportValidity() || payButton.disabled) return;
  if (typeof window.Razorpay !== "function") {
    message.textContent = "Secure payment could not be loaded. Check your connection and try again.";
    return;
  }
  payButton.disabled = true;
  payButton.textContent = "Creating secure order…";
  message.textContent = "";
  let createdOrderId = "";
  try {
    const data = new FormData(form);
    if (!checkoutRequestId) {
      checkoutRequestId = crypto.randomUUID();
      sessionStorage.setItem("wellexsa-checkout-request-id", checkoutRequestId);
    }
    const createOrder = httpsCallable(functions, "createPaymentOrder");
    const response = await createOrder({
      requestId: checkoutRequestId,
      items: readCart(),
      shipping: {
        name: data.get("name").trim(),
        phone: data.get("phone").trim(),
        address: data.get("address").trim(),
        city: data.get("city").trim(),
        state: data.get("state").trim(),
        postalCode: data.get("postalCode").trim()
      }
    });
    const order = response.data;
    createdOrderId = order.orderId;
    const checkout = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: "INR",
      name: "WELLEXSA MOTORS",
      description: "Electric scooter purchase",
      order_id: order.gatewayOrderId,
      prefill: { name: data.get("name"), email: currentUser.email, contact: data.get("phone") },
      notes: { showroomOrderId: order.orderId },
      theme: { color: "#292D32" },
      handler: async (payment) => {
        try {
          const verify = httpsCallable(functions, "verifyRazorpayPayment");
          const verification = await verify({ orderId: order.orderId, ...payment });
          if (verification.data.paymentStatus !== "captured") {
            throw new Error("Payment has not been verified as captured.");
          }
          localStorage.removeItem("wellexsa-cart-v1");
          sessionStorage.removeItem("wellexsa-checkout-request-id");
          window.location.assign(`account.html?order=${encodeURIComponent(order.orderId)}`);
        } catch (error) {
          message.textContent = "Payment was received by the gateway but is awaiting secure verification. Do not retry the payment; check your order history or contact the showroom.";
          console.error("Payment verification pending", error);
          payButton.disabled = false;
          payButton.textContent = "Retry secure payment";
        }
      },
      modal: {
        ondismiss: async () => {
          try {
            const result = await httpsCallable(functions, "cancelPendingPayment")({ orderId: order.orderId });
            if (["captured", "stock_conflict", "refunded"].includes(result.data.paymentStatus)) {
              window.location.assign(`account.html?order=${encodeURIComponent(order.orderId)}`);
              return;
            }
          } catch (error) {
            console.warn("Checkout cancellation is awaiting server confirmation", error.message);
          }
          payButton.disabled = false;
          payButton.textContent = "Continue to secure payment ↗";
          message.textContent = "Checkout was closed. No stock was deducted. You can safely retry or return to your account.";
        }
      }
    });
    checkout.on("payment.failed", async (failure) => {
      message.textContent = "Payment was not completed. You can try again; inventory is not reduced for failed payments.";
      console.warn("Razorpay payment attempt failed", failure.error?.code || "unknown");
      const failedPaymentId = failure.error?.metadata?.payment_id;
      if (failedPaymentId) {
        try {
          await httpsCallable(functions, "recordPaymentFailure")({ orderId: order.orderId, paymentId: failedPaymentId });
        } catch (error) {
          console.warn("Razorpay failure is awaiting webhook confirmation", error.message);
        }
      }
      payButton.disabled = false;
      payButton.textContent = "Retry secure payment";
    });
    checkout.open();
  } catch (error) {
    message.textContent = error.message || "Secure checkout could not be started. Please try again.";
    console.error("Could not start payment checkout", { orderId: createdOrderId, error });
    payButton.disabled = false;
    payButton.textContent = "Retry secure payment";
  }
});
