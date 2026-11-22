import { db, isFirebaseConfigured } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { createImageFallback, demoScooters, formatPrice, specificationFields } from "./bikes.js";
import { openEnquiryForm } from "./enquiry.js";
import { observeScrollElements } from "./site-nav.js";

const container = document.getElementById("bike-details");
const params = new URLSearchParams(window.location.search);
const bikeId = params.get("id");
const demoId = params.get("demo");
const setError = (text) => {
  const error = document.createElement("div");
  error.className = "details-error";
  error.textContent = text;
  container.replaceChildren(container.querySelector(".back-link"), error);
};

if (demoId) {
  const demoBike = demoScooters.find((bike) => bike.id === demoId);
  if (demoBike) renderBike(demoBike);
  else setError("This demonstration model could not be found. Return to the showroom to browse available models.");
} else if (!isFirebaseConfigured) {
  setError("This website is ready to connect to Firebase. Complete the setup instructions in README.md to view scooter details.");
} else if (!bikeId) {
  setError("No scooter was selected. Return to the showroom to browse available scooters.");
} else {
  onSnapshot(doc(db, "bikes", bikeId), (result) => {
    if (!result.exists() || result.data().status !== "published") {
      setError("This scooter is no longer available. Browse our current showroom selection.");
    } else {
      renderBike({ id: result.id, ...result.data() });
    }
  }, (error) => {
    setError("Scooter details could not be loaded. Please try again or contact our showroom.");
    console.error("Could not load scooter details", error);
  });
}

function renderBike(bike) {
  const isDemo = bike.demoData === true;
  const layout = document.createElement("div");
  layout.className = "details-layout";
  const gallery = document.createElement("div");
  const mainImage = document.createElement("div");
  mainImage.className = "details-gallery-main";
  const thumbnails = document.createElement("div");
  thumbnails.className = "details-thumbnails";
  const urls = Array.isArray(bike.imageUrls) ? bike.imageUrls.filter(Boolean) : [];
  if (!urls.length) mainImage.append(createImageFallback(bike.name));
  urls.forEach((url, index) => {
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${bike.name || "Electric scooter"}${urls.length > 1 ? ` photo ${index + 1}` : ""}`;
    if (index === 0) mainImage.append(image);
    if (urls.length > 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `details-thumbnail${index === 0 ? " active" : ""}`;
      button.setAttribute("aria-label", `Show photo ${index + 1}`);
      const thumb = document.createElement("img");
      thumb.src = url;
      thumb.alt = "";
      button.append(thumb);
      button.addEventListener("click", () => {
        const active = mainImage.querySelector("img");
        if (active) {
          active.src = url;
          active.alt = image.alt;
        }
        thumbnails.querySelectorAll(".details-thumbnail").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
      });
      thumbnails.append(button);
    }
  });
  gallery.append(mainImage, thumbnails);

  const copy = document.createElement("section");
  copy.className = "details-copy";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = bike.brand || "WELLEXSA SELECT";
  const title = document.createElement("h1");
  title.textContent = bike.name || "Electric scooter";
  const model = document.createElement("p");
  model.className = "details-model";
  model.textContent = bike.model || "";
  const price = document.createElement("p");
  price.className = "details-price";
  price.textContent = isDemo ? "Price and availability set by showroom" : formatPrice(bike.price);
  const description = document.createElement("p");
  description.className = "details-description";
  description.textContent = bike.description || bike.shortDescription || "";
  const demoNotice = document.createElement("p");
  demoNotice.className = "details-demo-notice";
  demoNotice.textContent = bike.id === "demo-tunwal-alfa-pro"
    ? "Demonstration listing only. No price or stock is set for this preview."
    : "Demonstration model only. These sample photos and specifications are unverified and are not an offer for sale.";
  const descriptionHeading = document.createElement("h2");
  descriptionHeading.className = "details-description-heading";
  descriptionHeading.textContent = "About this ride";
  const actions = document.createElement("div");
  actions.className = "details-cta";
  const stockCount = Number(bike.stockQuantity) || 0;
  const stock = document.createElement("p");
  stock.className = `stock-badge${isDemo ? " demo-badge" : stockCount > 0 ? "" : " out-of-stock"}`;
  stock.textContent = isDemo
    ? "DEMONSTRATION DATA · UNVERIFIED · NOT FOR SALE"
    : stockCount > 0 ? `In stock · ${stockCount} available` : "OUT OF STOCK";
  const enquireButton = document.createElement("button");
  enquireButton.type = "button";
  enquireButton.className = "button button-dark";
  const enquireLabel = document.createElement("span");
  enquireLabel.textContent = "Enquire Now";
  const enquireArrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  enquireArrow.setAttribute("viewBox", "0 0 24 24");
  enquireArrow.setAttribute("fill", "none");
  enquireArrow.setAttribute("stroke", "currentColor");
  enquireArrow.setAttribute("stroke-width", "1.8");
  enquireArrow.setAttribute("stroke-linecap", "round");
  enquireArrow.setAttribute("stroke-linejoin", "round");
  enquireArrow.setAttribute("aria-hidden", "true");
  enquireArrow.setAttribute("focusable", "false");
  enquireArrow.innerHTML = '<path d="M5 12h14M13 6l6 6-6 6"></path>';
  enquireButton.append(enquireLabel, enquireArrow);
  enquireButton.addEventListener("click", () => openEnquiryForm(bike));
  actions.append(enquireButton);
  copy.append(eyebrow, title, model, price, stock);
  if (isDemo) copy.append(demoNotice);
  if (description.textContent) copy.append(descriptionHeading, description);
  copy.append(actions);

  const specs = document.createElement("section");
  specs.className = "details-specs";
  const specsTitle = document.createElement("h2");
  specsTitle.textContent = "Specifications";
  const specList = document.createElement("div");
  specList.className = "spec-list";
  const additional = bike.specifications && typeof bike.specifications === "object" ? bike.specifications : {};
  const rows = [
    ...specificationFields.map(([key, label]) => [label, bike[key]]),
    ...Object.entries(additional).map(([label, value]) => [label, value])
  ];
  rows.forEach(([label, value]) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    const row = document.createElement("div");
    row.className = "spec-row";
    const icon = document.createElement("span");
    icon.className = "spec-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.append(createSpecificationIcon(String(label)));
    const name = document.createElement("span");
    name.textContent = label;
    const detail = document.createElement("span");
    detail.textContent = String(value);
    row.append(icon, name, detail);
    specList.append(row);
  });
  if (specList.childElementCount) specs.append(specsTitle, specList);
  copy.append(specs);
  layout.append(gallery, copy);
  container.replaceChildren(container.querySelector(".back-link"), layout);
  observeScrollElements([gallery, copy, ...specList.children]);
  document.title = `${bike.name || "Scooter details"} — WELLEXSA MOTORS`;
}

function createSpecificationIcon(label) {
  const key = label.toLowerCase();
  const markup = key.includes("warranty")
    ? '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"></path><path d="m9 12 2 2 4-4"></path>'
    : key.includes("battery") || key.includes("chemistry")
      ? '<rect x="3" y="7" width="17" height="10" rx="2"></rect><path d="M22 10v4M10 9l-2 3h4l-2 3"></path>'
      : key.includes("range") || key.includes("speed")
        ? '<path d="M5 19a9 9 0 1 1 14 0"></path><path d="m12 13 4-4"></path><circle cx="12" cy="13" r="1"></circle>'
        : key.includes("charg")
          ? '<path d="m13 2-3 9h6l-5 11 1-8H7l6-12Z"></path>'
          : key.includes("motor") || key.includes("controller")
            ? '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"></path>'
            : '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path>';
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.7");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.innerHTML = markup;
  return icon;
}
