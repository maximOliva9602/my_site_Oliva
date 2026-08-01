/* Відображення телефонів клієнтів залежно від дозволу майстра. */
function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return "•••• " + digits.slice(-4);
}

function visiblePhone(phone, showFull) {
  return showFull ? (phone || null) : maskPhone(phone);
}

module.exports = { maskPhone, visiblePhone };
