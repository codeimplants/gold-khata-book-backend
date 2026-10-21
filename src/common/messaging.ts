import { MessagingClient } from "@codeimplants/messaging-node";

let client: MessagingClient | null | undefined;

/**
 * The Code Implants Messaging client, or null while this environment still sends
 * OTPs through 2Factor directly.
 *
 * Messaging (msg.codeimplants.com) holds the 2Factor key this app shares with
 * SoneBill and Sone Taran, applies the per-number limits in one place, and
 * reports which shop used how many SMS. On dev it sends nothing and every code
 * is 123456 (owner's decision, 2026-10-21: no real SMS outside prod).
 *
 * The switch is MESSAGING_API_KEY in .env, not the code, because dev and prod
 * both deploy `main`: an environment moves, or moves back, with a restart, and
 * deploying this code to prod changes nothing there until its key is added.
 */
export function messagingClient(): MessagingClient | null {
  if (client === undefined) {
    const apiKey = process.env.MESSAGING_API_KEY?.trim();
    // A malformed key throws here, at the first OTP, rather than quietly
    // leaving an environment on 2Factor when someone meant to switch it.
    client = apiKey
      ? new MessagingClient({ apiKey, baseUrl: process.env.MESSAGING_BASE_URL?.trim() || undefined })
      : null;
  }
  return client;
}
