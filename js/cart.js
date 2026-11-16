import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { formatPrice, getBatteryRangeOptions, readCart, removeFromCart, updateCartQuantity, writeCart } from "./bikes.js";

const itemsContainer = document.getElementById("cart-items");
const message = document.getElementById("cart-message");
const checkoutButton = document.getElementById("checkout-button");
const products = new Map();
let listeners = [];
writeCart(readCart());

function render() {
  const cart = readCart();
  itemsContainer.replaceChildren();
  let total = 0;
  let canCheckout = cart.length > 0;
  if (!cart.length) {
    const empty = document.createElement("div");
    empty.className = "details-error";
    empty.textContent = "Your cart is empty. Browse our scooters to get started.";
    itemsContainer.append(empty);
    checkoutButton.disabled = true;
    document.getElementById("cart-total").textContent = formatPrice(0);
    return;
  }
  const quantitiesByBike = new Map();
  cart.forEach((entry) => {
    quantitiesByBike.set(entry.bikeId, (quantitiesByBike.get(entry.bikeId) || 0) + entry.quantity);
  });
  cart.forEach((entry) => {
    const bike = products.get(entry.bikeId);
    if (!bike) {
      canCheckout = false;
      const missing = document.createElement("article");
      missing.className = "cart-row";
      const notice = document.createElement("div");
      notice.className = "cart-item-detail";
      const title = document.createElement("h2");
      title.textContent = "Scooter unavailable";
      const detail = document.createElement("p");
      detail.textContent = "This bike is no longer listed. Remove it to continue.";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        removeFromCart(entry.bikeId, entry.batteryOption);
        render();
      });
      notice.append(title, detail, remove);
      missing.append(notice);
      itemsContainer.append(missing);
      return;
    }
    const stock = Number(bike.stockQuantity) || 0;
    const batteryOptions = getBatteryRangeOptions(bike);
    const selectedOption = batteryOptions.find((option) =>
      option.batteryType === entry.batteryOption?.batteryType && option.range === entry.batteryOption?.range
    );
    const optionValid = batteryOptions.length ? Boolean(selectedOption) : !entry.batteryOption;
    const valid = bike.status === "published" && stock > 0 &&
      quantitiesByBike.get(entry.bikeId) <= stock && optionValid;
    if (!valid) canCheckout = false;
    total += Number(bike.price) * entry.quantity;

    const row = document.createElement("article");
    row.className = "cart-row";
    const image = document.createElement("img");
    image.className = "cart-image";
    image.src = bike.imageUrls?.[0] || "";
    image.alt = bike.name || "Electric scooter";
    const detail = document.createElement("div");
    detail.className = "cart-item-detail";
    const title = document.createElement("h2");
    title.textContent = bike.name || "Electric scooter";
    let batterySelection = null;
    if (entry.batteryOption || batteryOptions.length) {
      batterySelection = document.createElement("p");
      batterySelection.textContent = selectedOption
        ? `Battery: ${selectedOption.batteryType} · Range: ${selectedOption.range} · Warranty: ${selectedOption.warranty}`
        : "Select an available battery and range from the product details page.";
    }
    const price = document.createElement("p");
    price.textContent = `${formatPrice(bike.price)} each`;
    const status = document.createElement("p");
    status.className = `stock-badge${valid ? "" : " out-of-stock"}`;
    status.textContent = valid
      ? `${stock} available`
      : !optionValid ? "Battery / range selection is no longer available"
        : stock === 0 ? "Out of stock" : "Quantity exceeds available stock";
    const controls = document.createElement("div");
    controls.className = "quantity-controls";
    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.textContent = "−";
    decrease.setAttribute("aria-label", `Decrease ${bike.name} quantity`);
    decrease.addEventListener("click", () => {
      updateCartQuantity(bike.id, entry.quantity - 1, entry.batteryOption);
      render();
    });
    const quantity = document.createElement("span");
    quantity.textContent = String(entry.quantity);
    const increase = document.createElement("button");
    increase.type = "button";
    increase.textContent = "+";
    increase.disabled = quantitiesByBike.get(entry.bikeId) >= stock;
    increase.setAttribute("aria-label", `Increase ${bike.name} quantity`);
    increase.addEventListener("click", () => {
      if (quantitiesByBike.get(entry.bikeId) < stock) {
        updateCartQuantity(bike.id, entry.quantity + 1, entry.batteryOption);
        render();
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      removeFromCart(bike.id, entry.batteryOption);
      render();
    });
    controls.append(decrease, quantity, increase, remove);
    detail.append(title);
    if (batterySelection) detail.append(batterySelection);
    detail.append(price, status, controls);
    const lineTotal = document.createElement("strong");
    lineTotal.className = "cart-line-total";
    lineTotal.textContent = formatPrice(Number(bike.price) * entry.quantity);
    row.append(image, detail, lineTotal);
    itemsContainer.append(row);
  });
  document.getElementById("cart-total").textContent = formatPrice(total);
  checkoutButton.disabled = !canCheckout;
  if (!canCheckout) message.textContent = "Update your quantities or remove unavailable scooters before checkout.";
  else message.textContent = "";
}

if (!isFirebaseConfigured) {
  message.textContent = "Firebase must be configured before scooter stock and checkout are available.";
  render();
} else {
  function subscribeToCart() {
    listeners.forEach((unsubscribe) => unsubscribe());
    listeners = [];
    for (const bikeId of new Set(readCart().map((item) => item.bikeId))) {
      const unsubscribe = onSnapshot(doc(db, "bikes", bikeId), (snapshot) => {
        if (snapshot.exists()) products.set(bikeId, { id: snapshot.id, ...snapshot.data() });
        else products.delete(bikeId);
        render();
      }, (error) => {
        message.textContent = "Current scooter availability could not be checked. Try refreshing the page.";
        console.error("Could not check cart stock", error);
      });
      listeners.push(unsubscribe);
    }
    render();
  }
  subscribeToCart();
  window.addEventListener("storage", subscribeToCart);
}

checkoutButton.addEventListener("click", () => {
  if (checkoutButton.disabled) return;
  window.location.assign(auth.currentUser ? "checkout.html" : "signin.html?return=checkout.html");
});
