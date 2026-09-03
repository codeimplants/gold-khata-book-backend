/**
 * Canonicalizes a phone number to a bare 10-digit string, stripping the
 * +91/91 country code, spaces, dashes, and any other non-digit characters.
 * Ensures the same real-world number always maps to the same lookup/creation
 * key regardless of how a client formatted it — "+919876543210",
 * "919876543210" and "9876543210" all normalize to "9876543210".
 */
export const normalizePhone = (phone: string | number): string => {
  const digits = String(phone).replace(/\D/g, "");
  return digits.slice(-10);
};
