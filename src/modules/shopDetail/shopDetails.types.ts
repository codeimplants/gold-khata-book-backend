export interface Address {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zipcode: number;
}

export interface IShopDetail {
    userId?: string;
    shopName: string;
    ownerName?: string;
    shopDescription?: string;
    address: Address;
    city: string;
    state: string;
    zipcode: number;
    phone: number;
    email?: string;
    website?: string;
    gstNo?: string;
    gstPercentage?: number; // This line already exists and matches the type requirement
    shopLogo?: string;
    shopHeader?: string;
    signature?: string;
    /** Shop-wide preferences — see the schema for why these are not per-device. */
    invoiceTemplate?: ShopInvoiceTemplate;
    appLanguage?: ShopLanguage;
    declarationLanguage?: ShopLanguage;
    createdAt?: Date;
}

export type ShopInvoiceTemplate =
    | "traditional"
    | "modern"
    | "classic"
    | "minimal"
    | "shopHeader"
    | "letterhead"
    | "taxInvoiceColor"
    | "taxInvoiceBold"
    | "taxInvoiceLetterhead";

export type ShopLanguage = "en" | "hi" | "mr" | "gu";

/**
 * What `PUT /shopDetails/preferences` accepts. Every key optional: a screen
 * that changes only the bill template must not have to resend the languages,
 * and an omitted key leaves the stored value alone.
 */
export interface UpdateShopPreferencesDTO {
    invoiceTemplate?: ShopInvoiceTemplate;
    appLanguage?: ShopLanguage;
    declarationLanguage?: ShopLanguage;
}

export type CreateShopDetailDTO = IShopDetail;

export type UpdateShopDetailDTO = Partial<IShopDetail>;

