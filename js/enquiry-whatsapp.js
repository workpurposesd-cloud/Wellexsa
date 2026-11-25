const showroomWhatsAppNumber = "919989992230";

export function buildWhatsAppUrl({
  scooterName,
  scooterModel,
  customerName,
  mobileNumber
}) {
  const message = [
    "Hello WELLEXSA MOTORS,",
    "",
    `I am interested in the ${scooterName} ${scooterModel}.`.trim(),
    "",
    `Customer Name: ${customerName}`,
    `Mobile Number: ${mobileNumber}`,
    "",
    "Enquiry: Please share the price, availability and more details."
  ].join("\n");
  return `https://wa.me/${showroomWhatsAppNumber}?text=${encodeURIComponent(message)}`;
}
