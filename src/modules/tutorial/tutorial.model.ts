import { model, Schema } from "mongoose";
import type { ITutorial, ITutorialCategory } from "./tutorial.types";

/**
 * Caps for admin-authored tutorial copy. Deliberately not in
 * common/constants/inputLimits.ts — that file's contract is "the mobile app
 * mirrors these numbers for shopkeeper input", and none of this is typed by a
 * shopkeeper.
 */
const LIMITS = {
  slug: 60,
  title: 80,
  description: 300,
  // Generous on purpose: the id itself is 11 characters, but a pasted URL must
  // reach the pattern validator so the admin is told *what* is wrong. Capping at
  // 20 meant a pasted link failed with "longer than the maximum allowed length",
  // which does not hint at the actual fix.
  youtubeId: 200,
  topic: 60,
  version: 20,
} as const;

/** Slugs are used in URLs, analytics event props and the app's topic lookup. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Dotted versionName, 1 to 4 parts: "1", "1.0", "1.0.16", "1.0.16.2". */
const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

/**
 * Numeric-part comparison, so "1.0.10" > "1.0.9" — which string comparison gets
 * wrong, and which is the exact case that matters as a version count passes 9.
 * Missing parts count as 0, so "1.1" and "1.1.0" are equal.
 */
const compareVersions = (a: string, b: string): number => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

const localizedTextSchema = (maxlength: number) => ({
  en: {
    type: String,
    required: [true, "English text is required"],
    trim: true,
    maxlength: maxlength,
  },
  hi: { type: String, trim: true, maxlength: maxlength },
  mr: { type: String, trim: true, maxlength: maxlength },
  gu: { type: String, trim: true, maxlength: maxlength },
});

/**
 * A YouTube id, not a URL. Pasting a full watch/share link is the most likely
 * admin mistake, and it fails silently as a black embed — so reject anything
 * that is not the bare 11-character id.
 */
const videoSchema = (required: boolean) => ({
  youtubeId: {
    type: String,
    required: required ? [true, "An English video is required"] : false,
    trim: true,
    maxlength: LIMITS.youtubeId,
    validate: {
      validator: (v: string) => !v || /^[A-Za-z0-9_-]{11}$/.test(v),
      message: "youtubeId must be the bare 11-character YouTube video id, not a URL",
    },
  },
  durationSec: { type: Number, min: 0 },
});

const tutorialCategorySchema = new Schema<ITutorialCategory>(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: LIMITS.slug,
      match: [SLUG_PATTERN, "slug must be lowercase words separated by hyphens"],
    },
    title: localizedTextSchema(LIMITS.title),
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

const tutorialSchema = new Schema<ITutorial>(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: LIMITS.slug,
      match: [SLUG_PATTERN, "slug must be lowercase words separated by hyphens"],
    },
    categoryId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: LIMITS.slug,
    },
    title: localizedTextSchema(LIMITS.title),
    description: {
      en: { type: String, trim: true, maxlength: LIMITS.description },
      hi: { type: String, trim: true, maxlength: LIMITS.description },
      mr: { type: String, trim: true, maxlength: LIMITS.description },
      gu: { type: String, trim: true, maxlength: LIMITS.description },
    },
    video: {
      en: { type: videoSchema(true), required: true },
      hi: { type: videoSchema(false) },
      mr: { type: videoSchema(false) },
      gu: { type: videoSchema(false) },
    },
    topics: [{ type: String, trim: true, maxlength: LIMITS.topic }],
    minAppVersion: {
      type: String,
      trim: true,
      maxlength: LIMITS.version,
      validate: {
        validator: (v: string) => !v || VERSION_PATTERN.test(v),
        message: "minAppVersion must be a dotted version like 1.0.16",
      },
    },
    maxAppVersion: {
      type: String,
      trim: true,
      maxlength: LIMITS.version,
      validate: {
        validator: (v: string) => !v || VERSION_PATTERN.test(v),
        message: "maxAppVersion must be a dotted version like 1.0.16",
      },
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

/**
 * An inverted range hides the tutorial from every build, which looks identical to
 * it having been deleted — so it is rejected at write time rather than left for an
 * admin to puzzle over.
 *
 * This lives in the service rather than as a schema hook or validator, because
 * neither covers both write paths: a `pre("validate")` hook is skipped by
 * `validateSync()`, and a cross-field custom validator sees the *query* rather
 * than the document under `findByIdAndUpdate`, so it silently passes on update.
 * An explicit check is the only version that fires for both create and update.
 *
 * Exported so the service can call it, and so the message stays next to the
 * comparison it depends on.
 */
export const versionRangeError = (
  minAppVersion?: string | null,
  maxAppVersion?: string | null
): string | null => {
  if (!minAppVersion || !maxAppVersion) return null;
  if (compareVersions(minAppVersion, maxAppVersion) <= 0) return null;
  return `minAppVersion (${minAppVersion}) is higher than maxAppVersion (${maxAppVersion}), so no app version would ever show this tutorial`;
};

// The app always reads the active library sorted by order; both lists are small
// enough that this is the only index worth having beyond the unique slugs.
tutorialSchema.index({ isActive: 1, order: 1 });
tutorialCategorySchema.index({ isActive: 1, order: 1 });

export const TutorialModel = model<ITutorial>("Tutorial", tutorialSchema);
export const TutorialCategoryModel = model<ITutorialCategory>(
  "TutorialCategory",
  tutorialCategorySchema
);
