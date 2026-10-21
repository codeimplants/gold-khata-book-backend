import { MessagingClient } from "@codeimplants/messaging-node";

let client: MessagingClient | null | undefined;

/**
 * The Code Implants Messaging client, or null when MESSAGING_API_KEY is missing,
 * in which case login answers "OTP service unavailable". Every environment sends
 * and checks its codes through it; the direct 2Factor path was removed on
 * 2026-10-21 once dev and prod had moved.
 *
 * Messaging (msg.codeimplants.com) holds the 2Factor key this app shares with
 * SoneBill and Sone Taran, applies the per-number limits in one place, and
 * reports which shop used how many SMS. On dev it sends nothing and every code
 * is 123456 (owner's decision, 2026-10-21: no real SMS outside prod).
 */
export function messagingClient(): MessagingClient | null {
  if (client === undefined) {
    const apiKey = process.env.MESSAGING_API_KEY?.trim();
    // A malformed key throws here, at the first OTP, so the misconfiguration
    // is loud rather than a silent "service unavailable".
    client = apiKey
      ? new MessagingClient({ apiKey, baseUrl: process.env.MESSAGING_BASE_URL?.trim() || undefined })
      : null;
  }
  return client;
}
