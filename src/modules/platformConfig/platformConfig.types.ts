/**
 * Version-control (Nexus) connection settings, served here so they can be
 * corrected without shipping a new build.
 *
 * 1.0.15 went out with an empty VITE_VC_API_KEY: the value had just moved to a
 * gitignored secrets.ts whose template defaults to '', and the release compiled
 * that in. Every version check failed and telemetry switched itself off, with
 * no remedy short of a store release. Serving these values makes that a config
 * change instead.
 *
 * Not secret: the same values ship inside every binary and only identify which
 * app is calling. Treat them as public.
 */
export interface IVersionControlConfig {
  /** Nexus base URL, e.g. https://api.nexus.codeimplants.com */
  backendUrl: string;
  /** The app's Nexus API key, sent as x-api-key. */
  apiKey: string;
}

/**
 * Feature flags as a key -> boolean map, so adding a flag is a config edit rather
 * than a deploy. Keys are owned by the app (gold-khata-book-frontend
 * src/featureFlags/registry.ts); anything unrecognised is ignored.
 *
 * A missing map or a missing key means "the app's compiled default", never "off".
 * Flags fail open on purpose: the alternative is that a config the app cannot read
 * silently removes working features, which is how 1.0.15 lost twelve days.
 */
export type FeatureFlagMap = Record<string, boolean>;

export interface IPlatformConfig {
  supportPhone: string;
  supportWhatsapp: string;
  supportEmail: string;
  supportAddress: string;
  versionControl: IVersionControlConfig;
  /** Optional: older backends and older config documents predate this field. */
  featureFlags?: FeatureFlagMap;
}

export type UpdatePlatformConfigDTO = Partial<IPlatformConfig>;
