import { db, isFirebaseConfigured } from "./firebase-config.js";
import { collection, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { createImageFallback, demoScooters, formatPrice, getBatteryRangeOptions } from "./bikes.js";
import { openEnquiryForm } from "./enquiry.js";
import { observeScrollElements } from "./site-nav.js";

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

const grid = document.getElementById("bike-grid");
const catalogImageObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const image = entry.target;
      const webpSource = image.parentElement.querySelector('source[type="image/webp"]');
      if (webpSource && webpSource.dataset.srcset) {
        webpSource.srcset = webpSource.dataset.srcset;
        delete webpSource.dataset.srcset;
      }
      image.src = image.dataset.src;
      delete image.dataset.src;
      observer.unobserve(image);
    });
  }, { rootMargin: "0px" })
  : null;
const demoNotice = document.getElementById("demo-notice");
const empty = document.getElementById("bike-empty");
const heroImage = document.getElementById("hero-scooter");
const heroWebpSource = document.getElementById("hero-scooter-webp");
const heroEnquiry = document.getElementById("hero-enquiry");
const featuredBikeName = document.getElementById("hero-bike-name");
const sliderControls = document.getElementById("slider-controls");
const sliderIndicators = document.getElementById("slider-indicators");
const sliderCount = document.getElementById("slider-count");
const previousSlideButton = document.querySelector(".slider-previous");
const nextSlideButton = document.querySelector(".slider-next");
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
    imageUrl: "assets/images/image2.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "YO Bykes YO Smart+",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image4.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "YO Bykes YO Smart",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image5.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "Tunwal Sport 63",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image3.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "YO Bykes YO DX",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image6.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "WELLEXSA Double Light",
    description: "Lithium and GEL battery options.",
    imageUrl: "assets/images/image7.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  },
  {
    title: "EoX Electric OKO",
    description: "Specified range: 60 KM.",
    imageUrl: "assets/images/image8.png",
    buttonText: "EXPLORE NOW",
    buttonUrl: "#bikes"
  }
];
let heroBike = demoScooters[0];
let highlightSlides = [];
let currentSlideIndex = 0;
let autoSlideTimer;
let transitionTimer;
let slideChangeRequest = 0;
let activeSlidesAreFallback = false;
const slideImageLoads = new Map();

function resolveBikeImageUrl(imageUrl) {
  if (typeof imageUrl !== "string") return "";
  const path = imageUrl.trim();
  const localImage = path.match(/^(?:\.\/|\/)?assets\/images\/(image[1-8])\.(?:jpe?g|jfif)$/i);
  return localImage ? `assets/images/${localImage[1].toLowerCase()}.png` : path;
}

function getWebpImageUrl(imageUrl) {
  const localImage = imageUrl.match(/^(?:\.\/|\/)?assets\/images\/(image[1-8]|wellexsa-logo)\.png$/i);
  return localImage ? `assets/images/${localImage[1].toLowerCase()}.webp` : "";
}

function updateSliderControls() {
  const hasMultipleSlides = highlightSlides.length > 1;
  sliderControls.hidden = !hasMultipleSlides;
  previousSlideButton.hidden = !hasMultipleSlides;
  nextSlideButton.hidden = !hasMultipleSlides;
  sliderIndicators.replaceChildren();

  if (!hasMultipleSlides) {
    sliderCount.textContent = "";
    return;
  }

  highlightSlides.forEach((slide, index) => {
    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.className = "slider-indicator";
    indicator.setAttribute("aria-label", `Show highlight image ${index + 1}: ${slide.title}`);
    indicator.addEventListener("click", () => {
      showSlide(index);
      restartAutoSlide();
    });
    sliderIndicators.append(indicator);
  });
}

function updateActiveSlideControls() {
  sliderIndicators.querySelectorAll("button").forEach((indicator, index) => {
    const isActive = index === currentSlideIndex;
    indicator.classList.toggle("is-active", isActive);
    indicator.setAttribute("aria-current", isActive ? "true" : "false");
  });
  if (highlightSlides.length > 1) {
    sliderCount.textContent = `${String(currentSlideIndex + 1).padStart(2, "0")} / ${String(highlightSlides.length).padStart(2, "0")}`;
  }
}

async function showSlide(index, animate = true) {
  if (!highlightSlides.length) return;

  const request = ++slideChangeRequest;
  const nextIndex = (index + highlightSlides.length) % highlightSlides.length;
  const slide = highlightSlides[nextIndex];
  window.clearTimeout(transitionTimer);
  const loadedSlide = await preloadSlide(slide);
  if (request !== slideChangeRequest) return;

  if (!loadedSlide) {
    highlightSlides.splice(nextIndex, 1);
    if (!highlightSlides.length) {
      if (activeSlidesAreFallback) {
        console.error("Could not load any homepage highlight images");
      } else {
        renderSlides([]);
      }
      return;
    }
    if (currentSlideIndex > nextIndex) currentSlideIndex -= 1;
    currentSlideIndex %= highlightSlides.length;
    updateSliderControls();
    showSlide(nextIndex % highlightSlides.length, false);
    return;
  }

  const previousIndex = currentSlideIndex;
  if (animate && nextIndex === previousIndex && !heroImage.classList.contains("is-transitioning")) {
    preloadNextSlide();
    return;
  }

  const title = typeof slide.title === "string" ? slide.title.trim() : "";
  const changeImage = () => {
    if (request !== slideChangeRequest) return;
    heroBike = { name: title, model: title };
    featuredBikeName.textContent = title;
    featuredBikeName.hidden = !title;
    heroWebpSource.srcset = loadedSlide.imageUrl.endsWith(".webp") ? loadedSlide.imageUrl : "";
    heroImage.src = slide.imageUrl;
    heroImage.alt = title ? `${title} electric scooter` : "Featured electric scooter";
    requestAnimationFrame(() => heroImage.classList.remove("is-transitioning"));
  };

  currentSlideIndex = nextIndex;
  updateActiveSlideControls();

  if (!animate || nextIndex === previousIndex) {
    heroImage.classList.remove("is-transitioning");
    changeImage();
  } else {
    heroImage.classList.add("is-transitioning");
    transitionTimer = window.setTimeout(changeImage, 220);
  }

  preloadNextSlide();
  if (!animate) restartAutoSlide();
}

function restartAutoSlide() {
  window.clearInterval(autoSlideTimer);
  if (highlightSlides.length < 2) return;
  autoSlideTimer = window.setInterval(() => showSlide(currentSlideIndex + 1), 4000);
}

function preloadSlide(slide) {
  const imageUrl = slide.imageUrl.trim();
  if (slideImageLoads.has(imageUrl)) return slideImageLoads.get(imageUrl);

  const load = new Promise((resolve) => {
    const preferredUrl = getWebpImageUrl(imageUrl) || imageUrl;
    const tryUrl = (url) => {
      const image = new Image();
      const finish = (loaded) => {
        image.onload = null;
        image.onerror = null;
        if (loaded) {
          resolve({ ...slide, imageUrl: url });
        } else if (url !== imageUrl) {
          tryUrl(imageUrl);
        } else {
          resolve(null);
        }
      };
      image.onload = () => finish(image.naturalWidth > 0);
      image.onerror = () => finish(false);
      image.src = url;
      if (image.complete) finish(image.naturalWidth > 0);
    };
    tryUrl(preferredUrl);
  });
  slideImageLoads.set(imageUrl, load);
  return load;
}

function preloadNextSlide() {
  if (highlightSlides.length > 1) {
    void preloadSlide(highlightSlides[(currentSlideIndex + 1) % highlightSlides.length]);
  }
}

function renderSlides(records) {
  const publishedSlides = records
    .filter((slide) => slide && typeof slide.imageUrl === "string" && slide.imageUrl.trim())
    .map((slide) => ({ ...slide, imageUrl: resolveBikeImageUrl(slide.imageUrl) }));
  activeSlidesAreFallback = publishedSlides.length === 0;
  highlightSlides = activeSlidesAreFallback ? fallbackSlides : publishedSlides;
  currentSlideIndex = 0;
  updateSliderControls();
  showSlide(0, false);
}

previousSlideButton.addEventListener("click", () => {
  showSlide(currentSlideIndex - 1);
  restartAutoSlide();
});
nextSlideButton.addEventListener("click", () => {
  showSlide(currentSlideIndex + 1);
  restartAutoSlide();
});
const sliderViewport = document.getElementById("slider-viewport");
let touchStartPoint;
sliderViewport.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || event.target.closest("button")) return;
  touchStartPoint = { x: event.clientX, y: event.clientY };
});
sliderViewport.addEventListener("pointerup", (event) => {
  if (!touchStartPoint || event.pointerType !== "touch") return;
  const deltaX = event.clientX - touchStartPoint.x;
  const deltaY = event.clientY - touchStartPoint.y;
  touchStartPoint = null;
  if (Math.abs(deltaX) < 45 || Math.abs(deltaY) > 80) return;
  showSlide(currentSlideIndex + (deltaX < 0 ? 1 : -1));
  restartAutoSlide();
});
sliderViewport.addEventListener("pointercancel", () => {
  touchStartPoint = null;
});

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
    const imageUrl = resolveBikeImageUrl(bike.imageUrls?.[0]);
    if (imageUrl) {
      const picture = document.createElement("picture");
      const webpSource = document.createElement("source");
      const webpUrl = getWebpImageUrl(imageUrl);
      if (webpUrl) {
        webpSource.type = "image/webp";
        webpSource.dataset.srcset = webpUrl;
        picture.append(webpSource);
      }
      const image = document.createElement("img");
      image.alt = isDemo ? `${bike.name} sample scooter photo` : bike.name || "Electric scooter";
      image.loading = "lazy";
      image.decoding = "async";
      image.fetchPriority = "low";
      image.addEventListener("error", () => {
        if (webpSource.srcset) {
          webpSource.removeAttribute("srcset");
          return;
        }
        imageArea.replaceChildren(createImageFallback(bike.name));
      });
      image.dataset.src = imageUrl;
      picture.append(image);
      imageArea.append(picture);
      if (catalogImageObserver) {
        catalogImageObserver.observe(image);
      } else {
        if (webpUrl) webpSource.srcset = webpUrl;
        image.src = imageUrl;
      }
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
    const formatWarrantyTerm = (value) => {
      if (typeof value !== "string") return "";
      const match = /^(\d+)\s+years?$/i.exec(value.trim());
      return match ? `${match[1]}-year` : value.trim();
    };
    const hasBatteryOptions = batteryOptions.length > 0;
    const fixedRange = additional["Specified Range"];
    const values = hasBatteryOptions
      ? [
        ...optionTypes.map((batteryType) => {
          const options = batteryOptions.filter((option) => option.batteryType === batteryType);
          const ranges = options.map((option) => option.range.replace(/\s*km$/i, "").trim());
          const rangeText = ranges.length > 1
            ? `${ranges.slice(0, -1).join(", ")} & ${ranges[ranges.length - 1]} km range options`
            : `${ranges[0]} km range`;
          return [batteryType, `${formatWarrantyTerm(options[0].warranty)} warranty · ${rangeText}`];
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
      block.className = "bike-card-spec-item";
      const caption = document.createElement("span");
      caption.className = "bike-card-spec-caption";
      const iconType = /battery/i.test(label) ? "battery" : /warranty/i.test(label) ? "warranty" : "";
      if (iconType) {
        const icon = document.createElement("span");
        icon.className = "bike-card-spec-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = iconType === "battery"
          ? '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="17" height="10" rx="2"></rect><path d="M20 10h2v4h-2M7 10v4m4-4v4m4-4v4"></path></svg>'
          : '<svg viewBox="0 0 24 24"><path d="m12 3 8 3v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"></path><path d="m9 12 2 2 4-4"></path></svg>';
        caption.append(icon, document.createTextNode(label));
      } else {
        caption.textContent = label;
      }
      const detail = document.createElement("strong");
      detail.className = "bike-card-spec-value";
      detail.textContent = /warranty/i.test(label)
        ? `${formatWarrantyTerm(String(value))} coverage`
        : String(value);
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
    observeScrollElements([card]);
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
