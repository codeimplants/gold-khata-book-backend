import { HydratedDocument } from "mongoose";
import PlatformConfig from "./platformConfig.model";
import { IPlatformConfig, UpdatePlatformConfigDTO } from "./platformConfig.types";

export type PlatformConfigDocument = HydratedDocument<IPlatformConfig>;

const DEFAULTS: IPlatformConfig = {
  supportPhone: "+919850929634",
  supportWhatsapp: "919850929634",
  supportEmail: "codeimplants@gmail.com",
  supportAddress:
    "Code Implants Software Technologies Pvt. Ltd., Maa Ganga Colony, Kalewadi, Pimpri-Chinchwad, Maharashtra 411017",
  versionControl: {
    backendUrl: "https://api.nexus.codeimplants.com",
    apiKey: "fdeac8d2-d724-4a85-b6c8-ed040163010b",
  },
};

export const PlatformConfigService = {
  async getConfig(): Promise<PlatformConfigDocument> {
    let config = await PlatformConfig.findOne();
    if (!config) {
      config = await PlatformConfig.create(DEFAULTS);
      return config;
    }

    // versionControl was added after this collection already had a document, so
    // backfill it rather than serving undefined to clients. Without this the
    // app silently falls back to whatever was compiled in — which is exactly
    // the failure mode this field exists to prevent.
    if (!config.versionControl?.backendUrl || !config.versionControl?.apiKey) {
      config.versionControl = DEFAULTS.versionControl;
      await config.save();
    }

    // featureFlags is deliberately NOT backfilled the way versionControl is, and
    // the difference matters. An absent versionControl breaks the version check,
    // so a value had to be invented. An absent featureFlags is a *correct* state:
    // it means "every flag uses the app's compiled default", which is what a shop
    // should get until someone deliberately changes a flag.
    //
    // Not writing also keeps this off the list of changes that mutate an existing
    // production document. Mongoose applies schema defaults on hydrate, so a
    // defaulted field would persist itself on the next save of a document nobody
    // meant to edit — the failure order.model.ts documents. `default: undefined`
    // on the field plus no backfill here means that cannot happen.
    return config;
  },

  async updateConfig(payload: UpdatePlatformConfigDTO): Promise<PlatformConfigDocument | null> {
    return await PlatformConfig.findOneAndUpdate({}, payload, {
      new: true,
      runValidators: true,
      upsert: true,
    });
  },
};
