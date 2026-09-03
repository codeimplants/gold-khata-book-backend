/**
 * Renders a phone number safe to write to a log: first two and last two digits
 * only — "9850929698" becomes "98••••••98".
 *
 * Enough to correlate a user's report with a log line and to tell two users
 * apart, without putting customers' full numbers in a file that every account
 * in the `adm` group can read and that gets copied around during debugging.
 */
export const maskPhone = (phone: string | number): string => {
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length < 6) return "•".repeat(digits.length);
    return `${digits.slice(0, 2)}${"•".repeat(digits.length - 4)}${digits.slice(-2)}`;
};
