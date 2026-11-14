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
    id: "demo-wellexsa-aura",
    name: "WELLEXSA AURA",
    model: "AURA",
    category: "Premium Urban",
    batteryCapacity: "3.0 kWh",
    batteryChemistry: "Lithium-ion",
    range: "120 km",
    topSpeed: "80 km/h",
    motor: "2.5 kW",
    chargingTime: "4–5 hours",
    brakes: "Disc / Drum",
    image: "assets/images/image1.jfif",
    shortDescription: "Refined comfort and clean lines, imagined for premium urban riding."
  },
  {
    id: "demo-wellexsa-vega",
    name: "WELLEXSA VEGA",
    model: "VEGA",
    category: "Premium Performance",
    batteryCapacity: "3.5 kWh",
    batteryChemistry: "Lithium-ion",
    range: "140 km",
    topSpeed: "90 km/h",
    motor: "3.0 kW",
    chargingTime: "4–5 hours",
    brakes: "Dual Disc",
    image: "assets/images/image4.jfif",
    shortDescription: "A performance-led concept for confident, longer urban routes."
  },
  {
    id: "demo-wellexsa-nova",
    name: "WELLEXSA NOVA",
    model: "NOVA",
    category: "City Commuter",
    batteryCapacity: "2.5 kWh",
    batteryChemistry: "Lithium-ion",
    range: "100 km",
    topSpeed: "75 km/h",
    motor: "2.0 kW",
    chargingTime: "4 hours",
    brakes: "Disc / Drum",
    image: "assets/images/image3.jfif",
    shortDescription: "Compact proportions and a practical silhouette for city journeys."
  },
  {
    id: "demo-wellexsa-titan",
    name: "WELLEXSA TITAN",
    model: "TITAN",
    category: "Performance",
    batteryCapacity: "4.0 kWh",
    batteryChemistry: "Lithium-ion",
    range: "160 km",
    topSpeed: "100 km/h",
    motor: "4.0 kW",
    chargingTime: "5–6 hours",
    brakes: "Dual Disc",
    image: "assets/images/image2.jfif",
    shortDescription: "A bold, high-output concept with a confident road presence."
  },
  {
    id: "demo-wellexsa-elite",
    name: "WELLEXSA ELITE",
    model: "ELITE",
    category: "Luxury",
    batteryCapacity: "3.2 kWh",
    batteryChemistry: "Lithium-ion",
    range: "130 km",
    topSpeed: "85 km/h",
    motor: "3.0 kW",
    chargingTime: "4–5 hours",
    brakes: "Disc / Drum",
    image: "assets/images/image5.jfif",
    shortDescription: "An understated luxury concept shaped around everyday comfort."
  },
  {
    id: "demo-wellexsa-prime",
    name: "WELLEXSA PRIME",
    model: "PRIME",
    category: "Everyday Premium",
    batteryCapacity: "3.0 kWh",
    batteryChemistry: "Lithium-ion",
    range: "115 km",
    topSpeed: "80 km/h",
    motor: "2.5 kW",
    chargingTime: "4 hours",
    brakes: "Disc / Drum",
    image: "assets/images/image6.jfif",
    shortDescription: "A balanced concept focused on convenience and daily versatility."
  },
  {
    id: "demo-wellexsa-storm",
    name: "WELLEXSA STORM",
    model: "STORM",
    category: "Sport",
    batteryCapacity: "4.2 kWh",
    batteryChemistry: "Lithium-ion",
    range: "150 km",
    topSpeed: "95 km/h",
    motor: "4.0 kW",
    chargingTime: "5–6 hours",
    brakes: "Dual Disc",
    image: "assets/images/image7.jfif",
    shortDescription: "A sport-focused concept with a dynamic stance and strong visual character."
  },
  {
    id: "demo-wellexsa-glide",
    name: "WELLEXSA GLIDE",
    model: "GLIDE",
    category: "Comfort",
    batteryCapacity: "2.8 kWh",
    batteryChemistry: "Lithium-ion",
    range: "110 km",
    topSpeed: "75 km/h",
    motor: "2.2 kW",
    chargingTime: "4 hours",
    brakes: "Disc / Drum",
    image: "assets/images/image8.jfif",
    shortDescription: "A smooth, comfort-led concept for relaxed everyday trips."
  },
  {
    id: "demo-wellexsa-zenith",
    name: "WELLEXSA ZENITH",
    model: "ZENITH",
    category: "Advanced Luxury",
    batteryCapacity: "3.8 kWh",
    batteryChemistry: "Lithium-ion",
    range: "145 km",
    topSpeed: "90 km/h",
    motor: "3.5 kW",
    chargingTime: "5 hours",
    brakes: "Dual Disc",
    image: "assets/images/image9.jfif",
    shortDescription: "An advanced luxury concept with elevated capability and detailing."
  },
  {
    id: "demo-wellexsa-edge",
    name: "WELLEXSA EDGE",
    model: "EDGE",
    category: "Smart Urban",
    batteryCapacity: "3.0 kWh",
    batteryChemistry: "Lithium-ion",
    range: "125 km",
    topSpeed: "85 km/h",
    motor: "3.0 kW",
    chargingTime: "4–5 hours",
    brakes: "Disc / Drum",
    image: "assets/images/image10.jfif",
    shortDescription: "A smart-urban concept with a focused, city-ready silhouette."
  }
].map((bike) => ({
  ...bike,
  brand: "WELLEXSA",
  demoData: true,
  status: "demo",
  price: null,
  stockQuantity: 0,
  batteryWarranty: "",
  description: "Demonstration content only. These specifications are unverified sample data, not confirmed production specifications. Confirm the price, warranty, images, availability and all specifications before publishing.",
  specifications: {
    "Battery capacity": bike.batteryCapacity,
    Brakes: bike.brakes,
    Category: bike.category,
    "Available colours": "To be confirmed by the showroom"
  },
  imageUrls: [bike.image]
}));

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
      Number.isInteger(item.quantity) && item.quantity > 0
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

export function addToCart(bike, quantity) {
  const cart = readCart();
  const existing = cart.find((item) => item.bikeId === bike.id);
  const nextQuantity = (existing?.quantity || 0) + quantity;
  const available = Number(bike.stockQuantity) || 0;
  if (nextQuantity > available) return false;
  if (existing) existing.quantity = nextQuantity;
  else cart.push({ bikeId: bike.id, quantity });
  writeCart(cart);
  return true;
}

export function updateCartQuantity(bikeId, quantity) {
  const cart = readCart();
  const item = cart.find((entry) => entry.bikeId === bikeId);
  if (!item) return;
  item.quantity = quantity;
  writeCart(cart.filter((entry) => entry.quantity > 0));
}

export function removeFromCart(bikeId) {
  writeCart(readCart().filter((item) => item.bikeId !== bikeId));
}
