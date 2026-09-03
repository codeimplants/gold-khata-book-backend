import https from "https";

// External live metal rate API (PNG / droidinfinity)
const EXTERNAL_API_URL = "https://goldpriceeditor.droidinfinity.com/api/external/metal-prices/1085";

/** Fetch live rates from external API and return in frontend-compatible shape. */
function fetchExternalRates(): Promise<{
  gold: {
    goldPrice24K995GW: number;
    goldPrice22K: number;
    goldPrice18K: number;
    goldPrice14K: number;
  };
  silver: {
    silverPrice: number;
    silverBarPrice: number;
  };
}> {
  return new Promise((resolve, reject) => {
    https
      .get(EXTERNAL_API_URL, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            if (!json.success || !json.rates) {
              return reject(new Error("Invalid response from metal rate API"));
            }
            const r = json.rates;
            const mapped = {
              gold: {
                goldPrice24K995GW: r.goldPrice24K995GW ?? 0,
                goldPrice22K: r.goldPrice22K ?? 0,
                goldPrice18K: r.goldPrice18K ?? 0,
                goldPrice14K: r.goldPrice14K ?? 0,
              },
              silver: {
                silverPrice: r.silverPrice ?? 0,
                silverBarPrice: r.silverBarPrice ?? 0,
              },
            };
            resolve(mapped);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

export const MetalRateService = {
  /** Get live metal rates from external PNG API. */
  async getRates(_dukandarId?: string) {
    return fetchExternalRates();
  },

  /** Update rates — disabled (rates now come from the external live API). */
  async updateRates(_dukandarId: string, _payload: any) {
    // Manual update disabled: rates come from the external live API.
    return fetchExternalRates();
  },
};
