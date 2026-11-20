import { db, isFirebaseConfigured } from "./firebase-config.js";
import { collection, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { createImageFallback, demoScooters, formatPrice, getBatteryRangeOptions } from "./bikes.js";
import { openEnquiryForm } from "./enquiry.js";
import "./site-nav.js";

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.01, rootMargin: "0px 0px -30px 0px" });
  document.querySelectorAll(".bikes-section, .benefits-section, .intro-strip, .contact-section, .visit-banner")
    .forEach((section) => {
      section.classList.add("reveal-on-scroll");
      revealObserver.observe(section);
    });
}

const grid = document.getElementById("bike-grid");
const demoNotice = document.getElementById("demo-notice");
const empty = document.getElementById("bike-empty");
const heroImage = document.getElementById("hero-scooter");
const heroEnquiry = document.getElementById("hero-enquiry");
const fallbackSlides = [
  {
    title: "Tunwal Alfa Pro",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image1.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "Tunwal Mini Lithino",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image2.jfif",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "YO Bykes YO Smart+",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image4.jfif",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "YO Bykes YO Smart",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image5.jfif",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "Tunwal Sport 63",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image3.jfif",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "YO Bykes YO DX",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image6.jfif",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "WELLEXSA Double Light",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image7.jfif",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "EoX Electric OKO",
    description: "Specified range: 60 KM.",
    imageUrl: "assets/images/image8.jfif",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  }
];
let heroBike = demoScooters[0];

function renderSlides(records) {
  const slide = records.find((item) => item.active === true) || records[0] || fallbackSlides[0];
  const title = String(slide.title || demoScooters[0].name).trim();
  heroBike = { name: title, model: title };
  heroImage.src = slide.imageUrl || fallbackSlides[0].imageUrl;
  heroImage.alt = `${title} electric scooter`;
}

heroImage.addEventListener("error", () => {
  const media = heroImage.parentElement;
  heroImage.remove();
  media.classList.add("hero-slide-media-empty");
  const fallbackText = document.createElement("span");
  fallbackText.textContent = "Scooter image unavailable";
  media.append(fallbackText);
}, { once: true });
heroEnquiry.addEventListener("click", () => openEnquiryForm(heroBike));
renderSlides([]);

function renderCatalog(bikes, demoMode = false) {
  grid.replaceChildren();
  demoNotice.hidden = !demoMode;
  empty.hidden = true;
  if (!bikes.length) return;

  for (const bike of bikes) {
    const isDemo = bike.demoData === true;
    const card = document.createElement("article");
    card.className = `bike-card${isDemo ? " is-demo" : ""}`;
    const imageArea = document.createElement("div");
    imageArea.className = "bike-card-image";
    if (bike.imageUrls?.[0]) {
      const image = document.createElement("img");
      image.src = bike.imageUrls[0];
      image.alt = isDemo ? `${bike.name} sample scooter photo` : bike.name || "Electric scooter";
      image.loading = "lazy";
      imageArea.append(image);
      image.addEventListener("error", () => imageArea.replaceChildren(createImageFallback(bike.name)));
    } else {
      imageArea.append(createImageFallback(bike.name));
    }

    const body = document.createElement("div");
    body.className = "bike-card-body";
    const title = document.createElement("h3");
    title.textContent = bike.name || "Electric scooter";
    const specs = document.createElement("div");
    specs.className = "bike-card-specs";
    const additional = bike.specifications && typeof bike.specifications === "object" ? bike.specifications : {};
    const batteryOptions = getBatteryRangeOptions(bike);
    const optionTypes = [...new Set(batteryOptions.map((option) => option.batteryType))];
    const controllerWarranty = additional["Motor Controller Warranty"];
    const hasBatteryOptions = batteryOptions.length > 0;
    const fixedRange = additional["Specified Range"];
    const values = hasBatteryOptions
      ? [
        ...optionTypes.map((batteryType) => {
          const options = batteryOptions.filter((option) => option.batteryType === batteryType);
          const ranges = options.map((option) => option.range).join(", ");
          return [batteryType, `${options[0].warranty} warranty · ${ranges}`];
        }),
        ["Motor controller warranty", controllerWarranty]
      ]
      : fixedRange
        ? [
          ["Battery type", additional["Battery Type"] || "Not specified"],
          ["Battery warranty", additional["Battery Warranty"]],
          ["Motor and controller warranty", additional["Motor and Controller Warranty"]],
          ["Specified range", fixedRange]
        ]
        : isDemo
        ? [
          ["Battery", bike.batteryChemistry],
          ["Range", bike.range],
          ["Top speed", bike.topSpeed],
          ["Motor", bike.motor],
          ["Charging", bike.chargingTime]
        ]
        : [
          ["Range", bike.range],
          ["Top speed", bike.topSpeed],
          ["Motor", bike.motor],
          ["Charging", bike.chargingTime]
        ];
    for (const [label, value] of values) {
      if (!value) continue;
      const block = document.createElement("div");
      const caption = document.createElement("span");
      caption.textContent = label;
      const detail = document.createElement("strong");
      detail.textContent = String(value);
      block.append(caption, detail);
      specs.append(block);
    }
    const stock = document.createElement("span");
    const stockCount = Number(bike.stockQuantity) || 0;
    stock.className = `stock-badge${isDemo ? " demo-badge" : stockCount > 0 ? "" : " out-of-stock"}`;
    stock.textContent = isDemo
      ? "DEMO SPECIFICATIONS · NOT VERIFIED"
      : stockCount > 0 ? `In stock · ${stockCount} available` : "OUT OF STOCK";
    const footer = document.createElement("div");
    footer.className = "bike-card-footer";
    const price = document.createElement("span");
    price.className = "bike-price";
    price.textContent = isDemo ? "Price set by showroom" : formatPrice(bike.price);
    const detailLink = document.createElement("a");
    detailLink.href = isDemo
      ? `bike-details.html?demo=${encodeURIComponent(bike.id)}`
      : `bike-details.html?id=${encodeURIComponent(bike.id)}`;
    detailLink.innerHTML = 'View Details <span aria-hidden="true">→</span>';
    footer.append(price, detailLink);
    body.append(title, specs, stock, makeEnquiryButton(bike), footer);
    card.append(imageArea, body);
    grid.append(card);
  }
}

function renderDemoCatalog(noticeText) {
  renderCatalog(demoScooters, true);
  demoNotice.textContent = noticeText;
}

if (!isFirebaseConfigured) {
  renderDemoCatalog("DEMO CATALOG ONLY — Firebase is not configured. These sample photos and specifications are not verified products, stock or prices.");
} else {
  renderDemoCatalog("LIVE LISTINGS LOADING — The cards below are demonstration concepts only, not verified products, stock or prices.");
  const activeSlides = query(
    collection(db, "homepageSlides"),
    where("status", "==", "published"),
    where("enabled", "==", true),
    orderBy("order", "asc")
  );
  onSnapshot(activeSlides, (snapshot) => {
    const publishedSlides = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.order - b.order);
    renderSlides(publishedSlides);
  }, (error) => {
    renderSlides([]);
    console.error("Could not load active homepage slides", error);
  });

  const publishedBikes = query(collection(db, "bikes"), where("status", "==", "published"));
  onSnapshot(publishedBikes, (snapshot) => {
    const bikes = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    bikes.sort((a, b) => {
      const dateA = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
      const dateB = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
      return dateB - dateA;
    });
    if (bikes.length) renderCatalog(bikes);
    else renderDemoCatalog("DEMONSTRATION MODE — The specifications below are sample data, not verified production specifications. Demo models have no price or stock and cannot be purchased. Use an admin template to verify and publish real listings.");
  }, (error) => {
    renderDemoCatalog("LIVE INVENTORY COULD NOT BE LOADED — The cards below are demonstration concepts only, not published inventory. Refresh the page or contact the showroom for verified listings.");
    console.error("Could not load published scooters", error);
  });
}

function makeEnquiryButton(bike) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-dark enquire-now";
  button.textContent = "ENQUIRE NOW →";
  button.addEventListener("click", () => openEnquiryForm(bike));
  return button;
}
