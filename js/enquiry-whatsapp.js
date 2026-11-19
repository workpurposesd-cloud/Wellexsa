const showroomWhatsAppNumber = "919989992230";

export function buildWhatsAppUrl(bikeModel, customerName, mobileNumber) {
  const message = [
    "Hello WELLEXSA MOTORS,",
    "",
    `I am interested in the ${bikeModel}.`,
    "",
    `Customer Name: ${customerName}`,
    `Mobile Number: ${mobileNumber}`,
    "",
    "Please contact me with more details."
  ].join("\n");
  return `https://wa.me/${showroomWhatsAppNumber}?text=${encodeURIComponent(message)}`;
}
