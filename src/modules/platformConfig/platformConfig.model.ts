import { model, Schema } from "mongoose";
import { IPlatformConfig } from "./platformConfig.types";

const platformConfigSchema = new Schema<IPlatformConfig>(
  {
    supportPhone: { type: String, required: true },
    supportWhatsapp: { type: String, required: true },
    supportEmail: { type: String, required: true },
    supportAddress: { type: String, required: true },
    // Optional so an existing config document keeps loading after this field was
    // added; the service fills the gap from DEFAULTS.
    versionControl: {
      backendUrl: { type: String, required: false },
      apiKey: { type: String, required: false },
    },
    /**
     * Feature flags, as a free-form key -> boolean map.
     *
     * Deliberately `Schema.Types.Mixed` rather than named boolean fields: a new
     * flag must be a config edit, not a backend deploy plus a migration. The app
     * owns the key list (src/featureFlags/registry.ts) and treats an unknown key
     * as absent, so a stale flag left here is inert rather than harmful.
     *
     * An absent map, or an absent key, means "use the app's compiled default" —
     * never "off". Flags fail open by design; see the registry for why.
     */
    featureFlags: {
      type: Schema.Types.Mixed,
      required: false,
      default: undefined,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const PlatformConfig = model<IPlatformConfig>("PlatformConfig", platformConfigSchema);
export default PlatformConfig;
