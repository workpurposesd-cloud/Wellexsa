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
    image: "assets/images/image1.png",
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
    image: "assets/images/image2.png",
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
    image: "assets/images/image3.png",
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
    image: "assets/images/image4.png",
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
    image: "assets/images/image5.png",
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
    image: "assets/images/image6.png",
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
    image: "assets/images/image7.png",
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
    image: "assets/images/image8.png",
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
