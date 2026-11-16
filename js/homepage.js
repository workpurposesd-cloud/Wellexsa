import { db, isFirebaseConfigured } from "./firebase-config.js";
import { collection, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { addToCart, createImageFallback, demoScooters, formatPrice, getBatteryRangeOptions, readCart, writeCart } from "./bikes.js";
import "./site-nav.js";

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
writeCart(readCart());

if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
  document.querySelectorAll(".bikes-section, .benefits-section, .intro-strip, .contact-section, .visit-banner")
    .forEach((section) => {
      section.classList.add("reveal-on-scroll");
      revealObserver.observe(section);
    });
}

const grid = document.getElementById("bike-grid");
const demoNotice = document.getElementById("demo-notice");
const empty = document.getElementById("bike-empty");
const sliderTrack = document.getElementById("slider-track");
const sliderViewport = document.getElementById("slider-viewport");
const sliderPrevious = document.getElementById("slider-previous");
const sliderNext = document.getElementById("slider-next");
const sliderIndicators = document.getElementById("slider-indicators");
const sliderCount = document.getElementById("slider-count");
const fallbackSlides = [
  {
    title: "Tunwal Alfa Pro",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image1.jfif",
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
let sliderTimer = 0;
let currentSlideIndex = 0;
let sliderPaused = false;
let slides = [];

function safeSlideDestination(destination) {
  try {
    const url = new URL(destination || "#contact", window.location.href);
    if (url.protocol === "https:" ||
        (url.origin === window.location.origin && ["http:", "file:"].includes(url.protocol))) {
      return destination || "#contact";
    }
  } catch (error) {
    console.warn("Invalid homepage slide destination; using showroom contact link.", error);
  }
  return "#contact";
}

function updateSlide(index) {
  if (!slides.length) return;
  currentSlideIndex = (index + slides.length) % slides.length;
  sliderTrack.querySelectorAll(".hero-slide").forEach((slide, slideIndex) => {
    const active = slideIndex === currentSlideIndex;
    slide.classList.toggle("is-active", active);
    slide.setAttribute("aria-hidden", String(!active));
  });
  sliderIndicators.querySelectorAll("button").forEach((button, buttonIndex) => {
    button.classList.toggle("is-active", buttonIndex === currentSlideIndex);
    button.setAttribute("aria-current", buttonIndex === currentSlideIndex ? "true" : "false");
  });
  sliderCount.textContent = `${String(currentSlideIndex + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
}

function stopSliderAutoplay() {
  window.clearInterval(sliderTimer);
  sliderTimer = 0;
}

function startSliderAutoplay() {
  stopSliderAutoplay();
  if (slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.visibilityState !== "visible" || sliderPaused) return;
  sliderTimer = window.setInterval(() => updateSlide(currentSlideIndex + 1), 5000);
}

function renderSlides(records) {
  stopSliderAutoplay();
  sliderTrack.replaceChildren();
  slides = records.length ? records : fallbackSlides;

  slides.forEach((slide, index) => {
    const article = document.createElement("article");
    article.className = "hero-slide";
    article.setAttribute("aria-hidden", "true");

    const copy = document.createElement("div");
    copy.className = "hero-slide-copy";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "WELLEXSA MOTORS · ELECTRIC COLLECTION";
    const heading = document.createElement("h1");
    heading.textContent = slide.title;
    const description = document.createElement("p");
    description.className = "hero-slide-description";
    description.textContent = slide.description || "";
    const actions = document.createElement("div");
    actions.className = "hero-actions";
    const primary = document.createElement("a");
    primary.className = "button button-dark";
    primary.href = safeSlideDestination(slide.buttonUrl);
    primary.textContent = slide.buttonText || "Explore bikes";
    const enquiry = document.createElement("a");
    enquiry.className = "text-link";
    enquiry.href = "#contact";
    enquiry.textContent = "Enquire now →";
    actions.append(primary, enquiry);
    copy.append(eyebrow, heading, description, actions);

    const media = document.createElement("div");
    media.className = "hero-slide-media";
    const image = document.createElement("img");
    image.src = slide.imageUrl;
    image.alt = slide.title ? `${slide.title} sample scooter photo` : "WELLEXSA electric scooter";
    image.loading = index === 0 ? "eager" : "lazy";
    image.addEventListener("error", () => {
      image.remove();
      media.classList.add("hero-slide-media-empty");
      const fallbackText = document.createElement("span");
      fallbackText.textContent = "Explore the WELLEXSA electric collection";
      media.append(fallbackText);
    }, { once: true });
    media.append(image);
    article.append(copy, media);
    sliderTrack.append(article);

    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.setAttribute("aria-label", `Show slide ${index + 1}: ${slide.title}`);
    indicator.addEventListener("click", () => {
      updateSlide(index);
      startSliderAutoplay();
    });
    sliderIndicators.append(indicator);
  });
  sliderPrevious.hidden = slides.length < 2;
  sliderNext.hidden = slides.length < 2;
  const activeIndex = Math.max(0, slides.findIndex((slide) => slide.active === true));
  updateSlide(activeIndex);
  startSliderAutoplay();
}

sliderPrevious.addEventListener("click", () => {
  updateSlide(currentSlideIndex - 1);
  startSliderAutoplay();
});
sliderNext.addEventListener("click", () => {
  updateSlide(currentSlideIndex + 1);
  startSliderAutoplay();
});
sliderViewport.addEventListener("pointerenter", () => {
  sliderPaused = true;
  stopSliderAutoplay();
});
sliderViewport.addEventListener("pointerleave", () => {
  sliderPaused = false;
  startSliderAutoplay();
});
sliderViewport.addEventListener("focusin", () => {
  sliderPaused = true;
  stopSliderAutoplay();
});
sliderViewport.addEventListener("focusout", (event) => {
  if (!sliderViewport.contains(event.relatedTarget)) {
    sliderPaused = false;
    startSliderAutoplay();
  }
});
sliderViewport.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") sliderViewport.dataset.swipeStart = String(event.clientX);
});
sliderViewport.addEventListener("pointerup", (event) => {
  const start = Number(sliderViewport.dataset.swipeStart);
  delete sliderViewport.dataset.swipeStart;
  if (!Number.isFinite(start) || Math.abs(event.clientX - start) < 45) return;
  updateSlide(currentSlideIndex + (event.clientX < start ? 1 : -1));
  startSliderAutoplay();
});
document.addEventListener("visibilitychange", startSliderAutoplay);
window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", startSliderAutoplay);
renderSlides(fallbackSlides);

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
    const top = document.createElement("div");
    top.className = "bike-card-topline";
    const brand = document.createElement("span");
    brand.textContent = isDemo ? `${bike.brand || "WELLEXSA"} · DEMO` : bike.brand || "WELLEXSA SELECT";
    const category = document.createElement("span");
    category.textContent = isDemo ? bike.category || bike.specifications?.Category || "Concept model" : bike.batteryWarranty || "";
    top.append(brand, category);
    const title = document.createElement("h3");
    title.textContent = bike.name || "Electric scooter";
    const model = document.createElement("p");
    model.className = "bike-card-model";
    model.textContent = bike.model || "Electric scooter";
    const description = document.createElement("p");
    description.className = "bike-card-description";
    description.textContent = bike.shortDescription || bike.description || "";
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
    body.append(top, title, model, description, specs, stock, footer, makeCartButton(bike));
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

function makeCartButton(bike) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-dark add-to-cart";
  const available = Number(bike.stockQuantity) || 0;
  const needsOption = getBatteryRangeOptions(bike).length > 0;
  button.disabled = bike.demoData === true || available <= 0;
  button.textContent = bike.demoData === true
    ? "Add to cart"
    : available <= 0 ? "Out of stock" : needsOption ? "Select battery / range" : "Add to cart";
  if (bike.demoData === true) {
    button.setAttribute("aria-label", `Add to cart unavailable for ${bike.name}; demo data only`);
    button.title = "Demo listing: add a verified price, photo and stock in the admin dashboard before publishing.";
  }
  button.addEventListener("click", () => {
    if (needsOption) {
      window.location.assign(`bike-details.html?id=${encodeURIComponent(bike.id)}`);
      return;
    }
    const added = addToCart(bike, 1);
    if (added) {
      button.textContent = "Added to cart";
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = "Add to cart";
      }, 1200);
    } else {
      button.textContent = "Stock limit reached";
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = "Add to cart";
      }, 1800);
    }
  });
  return button;
}
