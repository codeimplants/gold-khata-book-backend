/**
 * In-app video tutorials, served so the whole library can be changed without a
 * store release.
 *
 * This is deliberately NOT part of platformConfig. That document is fetched on
 * the launch critical path and carries the version-control backendUrl/apiKey
 * that drive force-update and the kill switch — the one mechanism that can fix a
 * bad release. Growing it with a content list would put the remedy behind a
 * payload that only exists to help new users, so tutorials get their own
 * endpoint, fetched lazily when someone actually opens the library.
 */

/** App UI languages. Mirrors `Language` in gold-khata-book-frontend/src/localization. */
export const TUTORIAL_LANGS = ["en", "hi", "mr", "gu"] as const;
export type TutorialLang = (typeof TUTORIAL_LANGS)[number];

/**
 * Text in whichever languages have been written so far. English is required and
 * is the fallback for the rest, so a half-translated tutorial is still usable
 * rather than blank.
 */
export type LocalizedText = Partial<Record<TutorialLang, string>> & { en: string };

export interface ITutorialVideo {
  /** YouTube video id only, never a full URL — the app builds the embed URL. */
  youtubeId: string;
  /** Shown on the list row so a shopkeeper on mobile data knows the cost up front. */
  durationSec?: number;
}

/**
 * Videos per language. English is required for the same reason as the text: a
 * tutorial that cannot play in any language is worse than no tutorial, because
 * it looks broken rather than absent.
 */
export type LocalizedVideo = Partial<Record<TutorialLang, ITutorialVideo>> & {
  en: ITutorialVideo;
};

export interface ITutorialCategory {
  /** Stable identifier used by tutorials to point here. Never reuse or rename. */
  slug: string;
  title: LocalizedText;
  order: number;
  isActive: boolean;
}

export interface ITutorial {
  /** Stable identifier the app navigates by, e.g. "create-invoice". */
  slug: string;
  /** Matches ITutorialCategory.slug. Not an ObjectId ref: slugs stay readable
   *  in the admin editor and survive a category being re-created. */
  categoryId: string;
  title: LocalizedText;
  description?: Partial<Record<TutorialLang, string>>;
  video: LocalizedVideo;
  /**
   * Screen keys this tutorial answers, used by the in-app "?" header icon to
   * show only what is relevant to the screen the user is stuck on. Free-form on
   * purpose: the app owns the key names, so new screens need no backend change.
   */
  topics?: string[];
  /**
   * App versions this tutorial applies to, inclusive, as dotted versionName
   * strings ("1.0.16"). Both optional; omitting both means "every version".
   *
   * Swapping a video only fixes an out-of-date recording. It does not fix a
   * redesigned screen: the moment invoice creation changes in 1.1.0, one video
   * cannot be correct for both 1.1.0 and the users still on 1.0.x — and some
   * never update. So a tutorial can declare its range, two entries can coexist
   * during a transition, and the old one is retired when that install base dies
   * off. Filtering happens in the app, not here: the cached library has to stay
   * correct offline across an app update, which a server-side filter baked into
   * the cached payload would not.
   */
  minAppVersion?: string;
  maxAppVersion?: string;
  order: number;
  isActive: boolean;
}

export type CreateTutorialDTO = Omit<ITutorial, "isActive"> & { isActive?: boolean };
export type UpdateTutorialDTO = Partial<ITutorial>;

export type CreateTutorialCategoryDTO = Omit<ITutorialCategory, "isActive"> & {
  isActive?: boolean;
};
export type UpdateTutorialCategoryDTO = Partial<ITutorialCategory>;

/** What GET / returns: the whole library in one request. */
export interface TutorialLibrary {
  categories: ITutorialCategory[];
  tutorials: ITutorial[];
}
