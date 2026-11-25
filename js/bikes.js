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

export function formatPrice(price) {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "Price pending";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(price);
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
  notice.textContent = "Verified scooter listings are not currently available. Contact WELLEXSA Motors for assistance.";
  container.append(notice);
}

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
