import { z } from "zod";
import { normalizePhone } from "../../common/utils/normalizePhone";

export const sendOtpSchema = z.object({
  phone: z.string().min(10, "Phone number is required").transform(normalizePhone),
});

export const deviceInfoSchema = z.object({
  platform: z.enum(["android", "ios", "web"]).optional(),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  osVersion: z.string().max(50).optional(),
  // The build the shopkeeper is running, reported from the installed binary on
  // login and on every app open. Backs the version badge and filter in the admin
  // dashboard. Kept optional: older builds send neither key.
  appVersion: z.string().max(50).optional(),
  buildNumber: z.string().max(50).optional(),
}).optional();

export const verifyOtpSchema = z.object({
  phone: z.string().min(10, "Phone number is required").transform(normalizePhone),
  otp: z.string().length(6, "OTP must be 6 digits"),
  fullhash: z.string().min(1, "Hash is required"),
  sessionId: z.string().min(1, "Session ID is required"),
  deviceInfo: deviceInfoSchema,
});
