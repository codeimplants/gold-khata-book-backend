import { z } from "zod";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";
import { deviceInfoSchema } from "../auth/auth.schema";

export const gstConfigSchema = z.object({
  gstGold: z.number().default(3),
  gstSilver: z.number().default(3),
  makingGSTRate: z.number().default(3),
});

export const createDukandarSchema = z.object({
  phone: z.number().min(1000000000, "Phone number must be at least 10 digits"),
  shopDetails: z.object({
    shopName: z.string().min(3, "Shop name is required").max(INPUT_LIMITS.shopName, `Shop name must be ${INPUT_LIMITS.shopName} characters or less`),
    ownerName: z.string().min(3, "Owner name is required").max(INPUT_LIMITS.ownerName, `Owner name must be ${INPUT_LIMITS.ownerName} characters or less`),
    phone: z.string().min(10).optional(),
    email: z.string().email().max(INPUT_LIMITS.email, `Email must be ${INPUT_LIMITS.email} characters or less`).optional(),
    address: z.string().min(5, "Address is required").max(INPUT_LIMITS.addressLine, `Address must be ${INPUT_LIMITS.addressLine} characters or less`),
    gstNumber: z.string().max(INPUT_LIMITS.gstin, `GST number must be ${INPUT_LIMITS.gstin} characters or less`).optional(),
    logo: z.string().optional(),
  }),
  product: z.string().optional(),
  gst: gstConfigSchema.partial().optional(),
});

/**
 * Re-exported from the login schema rather than declared again here.
 *
 * These were two separate literals, and they drifted: login accepted
 * appVersion/buildNumber while app-open did not. Zod strips undeclared keys, so
 * every app open silently discarded the version the app had sent AND overwrote
 * the stored deviceInfo without it -- erasing the version captured at login.
 * That is why the admin dashboard showed 69 of 71 shops as "Version unknown"
 * while Nexus, which reads its own telemetry, knew the build for all of them.
 * One definition means the two entry points cannot disagree again.
 */
export { deviceInfoSchema };

export const recordAppOpenSchema = z.object({
  deviceInfo: deviceInfoSchema.optional(),
});

export const updateDukandarSchema = z.object({
  phone: z.number().optional(),
  product: z.string().optional(),
  gst: gstConfigSchema.partial().optional(),
  shopDetails: z.object({
    shopName: z.string().max(INPUT_LIMITS.shopName, `Shop name must be ${INPUT_LIMITS.shopName} characters or less`).optional(),
    ownerName: z.string().max(INPUT_LIMITS.ownerName, `Owner name must be ${INPUT_LIMITS.ownerName} characters or less`).optional(),
    phone: z.string().optional(),
    email: z.string().max(INPUT_LIMITS.email, `Email must be ${INPUT_LIMITS.email} characters or less`).optional(),
    address: z.string().max(INPUT_LIMITS.addressLine, `Address must be ${INPUT_LIMITS.addressLine} characters or less`).optional(),
    gstNumber: z.string().max(INPUT_LIMITS.gstin, `GST number must be ${INPUT_LIMITS.gstin} characters or less`).optional(),
    logo: z.string().optional(),
  }).optional(),
});
