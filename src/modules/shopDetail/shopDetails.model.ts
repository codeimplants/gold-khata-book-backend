import { model, Schema } from "mongoose";
import type { IShopDetail, Address } from "./shopDetails.types";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

const addressSchema = new Schema<Address>(
    {
        line1: { type: String, required: true, trim: true, maxlength: [INPUT_LIMITS.addressLine, `Address line 1 cannot exceed ${INPUT_LIMITS.addressLine} characters`] },
        line2: { type: String, trim: true, maxlength: [INPUT_LIMITS.addressLine, `Address line 2 cannot exceed ${INPUT_LIMITS.addressLine} characters`] },
        city: { type: String, required: false, trim: true, maxlength: [INPUT_LIMITS.city, `City cannot exceed ${INPUT_LIMITS.city} characters`] },
        state: { type: String, required: false, trim: true, maxlength: [INPUT_LIMITS.state, `State cannot exceed ${INPUT_LIMITS.state} characters`] },
        zipcode: {
            type: Number,
            required: false,
        },
    },
    { _id: false }
);

const shopDetailSchema = new Schema<IShopDetail>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "Dukandar",
            required: false, // Make it optional for now to not break existing data, but will fill it in during account creation
        },
        shopName: {
            type: String,
            trim: true,
            default: "",
            maxlength: [INPUT_LIMITS.shopName, `Shop name cannot exceed ${INPUT_LIMITS.shopName} characters`],
            // Blank until the shop owner completes registration — required:true
            // would reject the "" default the auto-created account starts with.
            validate: {
                validator: (value: string) => value === "" || value.length >= 2,
                message: "Shop name must be at least 2 characters long",
            },
        },
        ownerName: {
            type: String,
            trim: true,
            maxlength: [INPUT_LIMITS.ownerName, `Owner name cannot exceed ${INPUT_LIMITS.ownerName} characters`],
        },
        shopDescription: {
            type: String,
            trim: true,
            maxlength: [INPUT_LIMITS.shopDescription, `Description cannot exceed ${INPUT_LIMITS.shopDescription} characters`],
        },

        address: addressSchema,

        phone: {
            type: Number,
            unique: true,
            validate: {
                validator: (value: number) =>
                    Number.isInteger(value) && value.toString().length === 10,
                message: "Phone number must be 10 digits",
            },
        },
        email: {
            type: String,
            lowercase: true,
            unique: true,
            sparse: true,
            trim: true,
            maxlength: [INPUT_LIMITS.email, `Email cannot exceed ${INPUT_LIMITS.email} characters`],
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please provide a valid email address"],
        },
        website: {
            type: String,
            trim: true,
            maxlength: [INPUT_LIMITS.website, `Website cannot exceed ${INPUT_LIMITS.website} characters`],
        },
        gstNo: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
            maxlength: [INPUT_LIMITS.gstin, `GST number cannot exceed ${INPUT_LIMITS.gstin} characters`],
        },
        gstPercentage: {
            type: Number,
            default: 3,
            min: 0,
            max: 100,
        },
        shopLogo: {
            type: String,
            trim: true,
        },
        shopHeader: {
            type: String,
            trim: true,
        },
        signature: {
            type: String,
            trim: true,
        },
        // --- Shop-wide preferences -------------------------------------------
        //
        // These three used to live only in the app's own storage (AsyncStorage,
        // which is localStorage on web), so they were per-device: a shop that
        // picked a bill template on the counter PC still saw the old one on the
        // back-office PC, and no amount of reloading fixed it because nothing
        // ever sent them to a server. They describe the SHOP, not the machine,
        // so they belong on the shop record.
        //
        // Deliberately NO `default`. Mongoose applies schema defaults on
        // hydrate, so a default here would write itself into every existing
        // shop on that document's next save — silently overriding the choice
        // each device already has stored locally. Left undefined, the app keeps
        // using its local value until someone saves a preference explicitly,
        // and that first save is what makes the shop's choice shared.
        //
        // The printer and paper settings are NOT here on purpose: a thermal
        // printer is physically attached to one machine, so those stay local.
        invoiceTemplate: {
            type: String,
            trim: true,
            // Enumerated rather than free string: this value now reaches every
            // device the shop uses, so one bad write would break the bill on
            // all of them at once. A new template must be added here before the
            // app that offers it ships — which the "backend first, always"
            // deploy order already requires.
            enum: {
                values: [
                    "traditional", "modern", "classic", "minimal", "shopHeader",
                    "letterhead", "taxInvoiceColor", "taxInvoiceBold", "taxInvoiceLetterhead",
                ],
                message: "{VALUE} is not a supported invoice template",
            },
        },
        appLanguage: {
            type: String,
            trim: true,
            enum: {
                values: ["en", "hi", "mr", "gu"],
                message: "{VALUE} is not a supported language",
            },
        },
        declarationLanguage: {
            type: String,
            trim: true,
            enum: {
                values: ["en", "hi", "mr", "gu"],
                message: "{VALUE} is not a supported language",
            },
        },

        createdAt: {
            type: Date,
            default: Date.now,
            immutable: true,
        },
    },
    {
        versionKey: false,
    }
);

export const ShopDetail = model<IShopDetail>("ShopDetails", shopDetailSchema);
