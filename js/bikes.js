export const specificationFields = [
  ["batteryChemistry", "Battery chemistry", true],
  ["range", "True range (KM)", true],
  ["batteryWarranty", "Battery warranty", true],
  ["motor", "Motor type", true],
  ["topSpeed", "Top speed (KM/H)", true],
  ["batteryLife", "Battery life / charge cycles"],
  ["chargingTime", "Charging time"],
  ["loadCapacity", "Load capacity"],
  ["groundClearance", "Ground clearance"],
  ["wheelbase", "Wheelbase"],
  ["paintFinish", "Paint finish"],
  ["keylessEntry", "Keyless entry"],
  ["antiTheft", "Anti-theft system"],
  ["gpsTracking", "GPS tracking"],
  ["appConnectivity", "App connectivity"],
  ["ipRating", "IP rating"]
];

export const demoScooters = [
  {
    id: "demo-tunwal-alfa-pro",
    name: "Tunwal Alfa Pro",
    model: "Alfa Pro",
    brand: "Tunwal",
    category: "Lithium + GEL battery options",
    batteryChemistry: "",
    range: "",
    topSpeed: "",
    motor: "",
    chargingTime: "",
    image: "assets/images/image1.jfif",
    shortDescription: "Available in Lithium and GEL battery options. Compare each option's warranty and range below.",
    description: "Tunwal Alfa Pro with Lithium and GEL battery options. See the separate warranty and range details below.",
    specifications: {
      "Battery Type Options": "Lithium Battery and GEL Battery",
      "Lithium Battery Warranty": "3 Years",
      "Lithium Battery Range Options": "60 KM, 80 KM, 110 KM",
      "GEL Battery Warranty": "1 Year",
      "GEL Battery Range": "60–70 KM",
      "Motor Controller Warranty": "1 Year"
    }
  },
  {
    id: "demo-tunwal-mini-lithino",
    name: "Tunwal Mini Lithino",
    model: "Mini Lithino",
    brand: "Tunwal",
    category: "Lithium + GEL battery options",
    image: "assets/images/image2.jfif",
    shortDescription: "Lithium and GEL battery options with model-specific warranty and range details.",
    specifications: {
      "Battery Type Options": "Lithium Battery and GEL Battery",
      "Lithium Battery Warranty": "3 Years",
      "Lithium Battery Range Options": "60 KM, 80 KM",
      "GEL Battery Warranty": "1 Year",
      "GEL Battery Range": "60–70 KM",
      "Motor Controller Warranty": "1 Year"
    }
  },
  {
    id: "demo-tunwal-sport-63",
    name: "Tunwal Sport 63",
    model: "Sport 63",
    brand: "Tunwal",
    category: "Lithium + GEL battery options",
    image: "assets/images/image3.jfif",
    shortDescription: "Lithium and GEL battery options with model-specific warranty and range details.",
    specifications: {
      "Battery Type Options": "Lithium Battery and GEL Battery",
      "Lithium Battery Warranty": "3 Years",
      "Lithium Battery Range Options": "60 KM, 80 KM",
      "GEL Battery Warranty": "1 Year",
      "GEL Battery Range": "60–70 KM",
      "Motor Controller Warranty": "1 Year"
    }
  },
  {
    id: "demo-yo-smart-plus",
    name: "YO Bykes YO Smart+",
    model: "YO Smart+",
    brand: "YO Bykes",
    category: "Lithium + GEL battery options",
    image: "assets/images/image4.jfif",
    shortDescription: "Lithium and GEL battery options with model-specific warranty and range details.",
    specifications: {
      "Battery Type Options": "Lithium Battery and GEL Battery",
      "Lithium Battery Warranty": "3 Years",
      "Lithium Battery Range Options": "60 KM, 80 KM, 110 KM",
      "GEL Battery Warranty": "1 Year",
      "GEL Battery Range": "60–70 KM",
      "Motor Controller Warranty": "3 Years"
    }
  },
  {
    id: "demo-yo-smart",
    name: "YO Bykes YO Smart",
    model: "YO Smart",
    brand: "YO Bykes",
    category: "Lithium + GEL battery options",
    image: "assets/images/image5.jfif",
    shortDescription: "Lithium and GEL battery options with model-specific warranty and range details.",
    specifications: {
      "Battery Type Options": "Lithium Battery and GEL Battery",
      "Lithium Battery Warranty": "3 Years",
      "Lithium Battery Range Options": "60 KM, 80 KM, 110 KM",
      "GEL Battery Warranty": "1 Year",
      "GEL Battery Range": "60–70 KM",
      "Motor Controller Warranty": "3 Years"
    }
  },
  {
    id: "demo-yo-dx",
    name: "YO Bykes YO DX",
    model: "YO DX",
    brand: "YO Bykes",
    category: "Lithium + GEL battery options",
    image: "assets/images/image6.jfif",
    shortDescription: "Lithium and GEL battery options with model-specific warranty and range details.",
    specifications: {
      "Battery Type Options": "Lithium Battery and GEL Battery",
      "Lithium Battery Warranty": "3 Years",
      "Lithium Battery Range Options": "60 KM, 80 KM",
      "GEL Battery Warranty": "1 Year",
      "GEL Battery Range": "60–70 KM",
      "Motor Controller Warranty": "3 Years"
    }
  },
  {
    id: "demo-wellexsa-double-light",
    name: "WELLEXSA Double Light",
    model: "Double Light",
    brand: "WELLEXSA",
    category: "Lithium + GEL battery options",
    image: "assets/images/image7.jfif",
    shortDescription: "Lithium and GEL battery options with model-specific warranty and range details.",
    specifications: {
      "Battery Type Options": "Lithium Battery and GEL Battery",
      "Lithium Battery Warranty": "3 Years",
      "Lithium Battery Range Options": "60 KM, 80 KM, 110 KM",
      "GEL Battery Warranty": "1 Year",
      "GEL Battery Range": "60–70 KM",
      "Motor Controller Warranty": "1 Year"
    }
  },
  {
    id: "demo-eox-oko",
    name: "EoX Electric OKO",
    model: "OKO",
    brand: "EoX Electric",
    category: "Specified range: 60 KM",
    image: "assets/images/image8.jfif",
    shortDescription: "Specified range: 60 KM. Battery type is not specified.",
    specifications: {
      "Battery Type": "Not specified",
      "Battery Warranty": "2 Years",
      "Specified Range": "60 KM",
      "Motor and Controller Warranty": "2 Years"
    }
  }
].map((bike) => ({
  ...bike,
  brand: bike.brand || "WELLEXSA",
  demoData: true,
  status: "demo",
  price: null,
  stockQuantity: 0,
  batteryChemistry: bike.batteryChemistry || "",
  range: bike.range || "",
  batteryWarranty: bike.batteryWarranty || "",
  description: bike.description || "Demonstration content only. These specifications are unverified sample data, not confirmed production specifications. Confirm the price, warranty, images, availability and all specifications before publishing.",
  specifications: bike.specifications || {
    "Battery capacity": bike.batteryCapacity,
    Brakes: bike.brakes,
    Category: bike.category,
    "Available colours": "To be confirmed by the showroom"
  },
  imageUrls: [bike.image]
}));

export function getBatteryRangeOptions(bike) {
  const specifications = bike?.specifications;
  if (!specifications || typeof specifications !== "object") return [];

  return [
    ["Lithium Battery", "Lithium Battery Warranty", "Lithium Battery Range Options"],
    ["GEL Battery", "GEL Battery Warranty", "GEL Battery Range"]
  ].flatMap(([batteryType, warrantyKey, rangesKey]) => {
    const warranty = specifications[warrantyKey];
    const ranges = specifications[rangesKey];
    if (typeof warranty !== "string" || typeof ranges !== "string") return [];

    return ranges.split(",").map((range) => range.trim()).filter(Boolean).map((range) => ({
      batteryType,
      range,
      warranty
    }));
  });
}

export function formatPrice(price) {
  const amount = Number(price);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount)
    : "Price on enquiry";
}

export function createImageFallback(name) {
  const wrapper = document.createElement("div");
  wrapper.className = "bike-image-fallback";
  const title = document.createElement("strong");
  title.textContent = name || "Electric ride";
  const subtitle = document.createElement("span");
  subtitle.textContent = "PHOTO COMING SOON";
  wrapper.append(title, subtitle);
  return wrapper;
}

export function showFirebaseSetupMessage(container) {
  container.replaceChildren();
  const notice = document.createElement("div");
  notice.className = "details-error";
  notice.textContent = "This website is ready to connect to Firebase. Complete the Firebase setup in README.md to load live scooter listings.";
  container.append(notice);
}

const cartStorageKey = "wellexsa-cart-v1";

export function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(cartStorageKey) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((item) =>
      item && typeof item.bikeId === "string" &&
      Number.isInteger(item.quantity) && item.quantity > 0 &&
      (item.batteryOption === undefined ||
        (item.batteryOption && typeof item.batteryOption.batteryType === "string" &&
          typeof item.batteryOption.range === "string"))
    );
  } catch {
    return [];
  }
}

export function writeCart(items) {
  localStorage.setItem(cartStorageKey, JSON.stringify(items));
  document.querySelectorAll(".cart-count").forEach((counter) => {
    counter.textContent = String(items.reduce((total, item) => total + item.quantity, 0));
  });
}

function sameBatteryOption(first, second) {
  return (first?.batteryType || "") === (second?.batteryType || "") &&
    (first?.range || "") === (second?.range || "");
}

export function addToCart(bike, quantity, batteryOption = null) {
  if (!bike || bike.demoData === true || !Number.isInteger(quantity) || quantity < 1) return false;
  const options = getBatteryRangeOptions(bike);
  const selectedOption = batteryOption &&
    options.find((option) => option.batteryType === batteryOption.batteryType && option.range === batteryOption.range);
  if ((options.length > 0 && !selectedOption) || (options.length === 0 && batteryOption)) return false;

  const cart = readCart();
  const existing = cart.find((item) => item.bikeId === bike.id && sameBatteryOption(item.batteryOption, selectedOption));
  const totalQuantity = cart
    .filter((item) => item.bikeId === bike.id)
    .reduce((total, item) => total + item.quantity, 0) + quantity;
  const available = Number(bike.stockQuantity) || 0;
  if (totalQuantity > available) return false;
  if (existing) existing.quantity += quantity;
  else cart.push({
    bikeId: bike.id,
    quantity,
    ...(selectedOption ? { batteryOption: { batteryType: selectedOption.batteryType, range: selectedOption.range } } : {})
  });
  writeCart(cart);
  return true;
}

export function updateCartQuantity(bikeId, quantity, batteryOption = null) {
  const cart = readCart();
  const item = cart.find((entry) => entry.bikeId === bikeId && sameBatteryOption(entry.batteryOption, batteryOption));
  if (!item) return;
  item.quantity = quantity;
  writeCart(cart.filter((entry) => entry.quantity > 0));
}

export function removeFromCart(bikeId, batteryOption = null) {
  const cart = readCart();
  writeCart(cart.filter((item) =>
    item.bikeId !== bikeId || !sameBatteryOption(item.batteryOption, batteryOption)
  ));
}
