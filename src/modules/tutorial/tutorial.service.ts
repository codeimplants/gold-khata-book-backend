import { Types } from "mongoose";
import { TutorialCategoryModel, TutorialModel, versionRangeError } from "./tutorial.model";
import { AppError } from "../../common/errors/AppError";
import type {
  CreateTutorialCategoryDTO,
  CreateTutorialDTO,
  ITutorialCategory,
  TutorialLibrary,
  UpdateTutorialCategoryDTO,
  UpdateTutorialDTO,
} from "./tutorial.types";

/**
 * Starter categories, created on first read the way platformConfig seeds its
 * DEFAULTS. Only categories are seeded: a tutorial needs a real YouTube id, and
 * a placeholder id ships a black player that reads as a broken app. Tutorials
 * are added through the admin editor once the videos exist.
 */
const DEFAULT_CATEGORIES: ITutorialCategory[] = [
  {
    slug: "getting-started",
    title: {
      en: "Getting Started",
      hi: "शुरुआत करें",
      mr: "सुरुवात करा",
      gu: "શરૂઆત કરો",
    },
    order: 10,
    isActive: true,
  },
  {
    slug: "billing",
    title: {
      en: "Billing & Invoices",
      hi: "बिलिंग और इनवॉइस",
      mr: "बिलिंग आणि बिले",
      gu: "બિલિંગ અને ઇન્વોઇસ",
    },
    order: 20,
    isActive: true,
  },
  {
    slug: "advance-orders",
    title: {
      en: "Advance Orders",
      hi: "एडवांस ऑर्डर",
      mr: "अ‍ॅडव्हान्स ऑर्डर",
      gu: "એડવાન્સ ઓર્ડર",
    },
    order: 30,
    isActive: true,
  },
  {
    slug: "customers",
    title: {
      en: "Customers",
      hi: "ग्राहक",
      mr: "ग्राहक",
      gu: "ગ્રાહકો",
    },
    order: 40,
    isActive: true,
  },
  {
    slug: "settings-printing",
    title: {
      en: "Settings & Printing",
      hi: "सेटिंग्स और प्रिंटिंग",
      mr: "सेटिंग्ज आणि प्रिंटिंग",
      gu: "સેટિંગ્સ અને પ્રિન્ટિંગ",
    },
    order: 50,
    isActive: true,
  },
];

/** Seeds the starter categories once, on an empty collection. */
const ensureCategoriesSeeded = async (): Promise<void> => {
  const count = await TutorialCategoryModel.estimatedDocumentCount();
  if (count > 0) return;
  try {
    await TutorialCategoryModel.insertMany(DEFAULT_CATEGORIES, { ordered: false });
  } catch {
    // A concurrent boot may have seeded first; the unique slug index makes that
    // a duplicate-key error, not a problem worth failing the request over.
  }
};

/** Throws a 400 when the version range would hide the tutorial from every build. */
const assertVersionRange = (min?: string | null, max?: string | null): void => {
  const message = versionRangeError(min, max);
  if (message) {
    throw new AppError(message, { statusCode: 400, code: "VALIDATION_ERROR" });
  }
};

export const TutorialService = {
  /**
   * The public library. Inactive records are filtered out here rather than in the
   * app so an admin can retire a tutorial — a video taken down, a screen
   * redesigned — and have every installed app stop offering it immediately.
   */
  async getLibrary(): Promise<TutorialLibrary> {
    await ensureCategoriesSeeded();
    const [categories, tutorials] = await Promise.all([
      TutorialCategoryModel.find({ isActive: true }).sort({ order: 1, slug: 1 }).lean(),
      TutorialModel.find({ isActive: true }).sort({ order: 1, slug: 1 }).lean(),
    ]);
    // A tutorial whose category was retired would otherwise vanish into a group
    // the app never renders, so re-home those instead of dropping them.
    const liveCategories = new Set(categories.map(c => c.slug));
    const reachable = tutorials.map(t =>
      liveCategories.has(t.categoryId) ? t : { ...t, categoryId: "getting-started" }
    );
    return { categories, tutorials: reachable } as TutorialLibrary;
  },

  /** Admin view: everything, including retired records. */
  async getAllForAdmin(): Promise<TutorialLibrary> {
    await ensureCategoriesSeeded();
    const [categories, tutorials] = await Promise.all([
      TutorialCategoryModel.find().sort({ order: 1, slug: 1 }).lean(),
      TutorialModel.find().sort({ order: 1, slug: 1 }).lean(),
    ]);
    return { categories, tutorials } as TutorialLibrary;
  },

  async create(payload: CreateTutorialDTO) {
    assertVersionRange(payload.minAppVersion, payload.maxAppVersion);
    return TutorialModel.create(payload);
  },

  async update(id: string, payload: UpdateTutorialDTO) {
    if (!Types.ObjectId.isValid(id)) return null;
    // Both bounds have to be resolved against the stored document, not just the
    // patch: sending only maxAppVersion must still be checked against the
    // minAppVersion already on record, or a partial update can invert the range.
    const existing = await TutorialModel.findById(id).lean();
    if (!existing) return null;
    assertVersionRange(
      payload.minAppVersion !== undefined ? payload.minAppVersion : existing.minAppVersion,
      payload.maxAppVersion !== undefined ? payload.maxAppVersion : existing.maxAppVersion
    );
    return TutorialModel.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    }).lean();
  },

  async delete(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return TutorialModel.findByIdAndDelete(id).lean();
  },

  async createCategory(payload: CreateTutorialCategoryDTO) {
    return TutorialCategoryModel.create(payload);
  },

  async updateCategory(id: string, payload: UpdateTutorialCategoryDTO) {
    if (!Types.ObjectId.isValid(id)) return null;
    return TutorialCategoryModel.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    }).lean();
  },

  /**
   * Refuses while tutorials still point at the category. Deleting anyway would
   * leave them orphaned and silently re-homed by getLibrary(), which hides the
   * mistake instead of surfacing it at the moment it is made.
   */
  async deleteCategory(id: string) {
    if (!Types.ObjectId.isValid(id)) return { deleted: null, inUse: 0 };
    const category = await TutorialCategoryModel.findById(id).lean();
    if (!category) return { deleted: null, inUse: 0 };
    const inUse = await TutorialModel.countDocuments({ categoryId: category.slug });
    if (inUse > 0) return { deleted: null, inUse };
    const deleted = await TutorialCategoryModel.findByIdAndDelete(id).lean();
    return { deleted, inUse: 0 };
  },
};
