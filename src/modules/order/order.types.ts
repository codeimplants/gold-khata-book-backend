import { Types } from "mongoose";
import type { OrnamentExchangeItem } from "../invoice/invoice.types";

export interface AdvancePayment {
    _id?: Types.ObjectId;
    date: Date;
    amount: number;
    goldRate: number; // Rate per gram at the time of payment
    weightCovered: number; // Weight covered by this payment in grams
    paymentType?: "advance" | "final";
    notes?: string;
}

export type OrderStatus = "pending" | "completed" | "cancelled";
export type PaymentMode = "complete" | "advance";

export interface OrderItem {
    itemName: string;
    itemType: "Gold" | "Silver";
    purity: string;
    weight: number;
    grossWeight?: number;
    lessWeight?: number;
    rate?: number;
    makingChargeType: "Per Gram" | "%" | "Fix";
    makingChargeValue: number;
    chargeDescription?: string;
    chargeAmount?: number;
    discountType?: string;
    discount?: number;
    /**
     * Optional photos of the item being made/sold. Distinct from
     * `Order.ornamentPhotos`, which are the old ornaments taken IN.
     */
    photos?: { url: string; fileId: string }[];
}

export interface Order {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    customerId: Types.ObjectId;
    dukandarId?: Types.ObjectId;

    orderNumber: string;
    orderDate: Date;

    // Items
    items: OrderItem[];

    // Aggregates (calculated or provided)
    totalWeight: number; // Total weight in grams

    // Payment mode
    paymentMode: PaymentMode;

    // Payment tracking
    payments: AdvancePayment[];
    totalPaid: number;
    weightPaid: number;
    remainingWeight: number;
    estimatedBalance: number;
    estimatedMakingCharges?: number;
    bookingRate: number;
    amount?: number; // Total estimated value (Gold + Making + GST - Exchange)
    initialTotalWeight?: number;

    includeGST: boolean;
    isOrnamentExchanges: boolean;
    ornamentExchanges?: OrnamentExchangeItem[];
    /** Grams the old gold settled — counts toward weightPaid like a payment does. */
    exchangeWeightCovered?: number;
    /** Surplus owed back to the customer when old gold exceeds the order value. */
    exchangeExcess?: number;
    /** Photos of the old ornaments taken in against this order. */
    ornamentPhotos?: { url: string; fileId: string }[];

    /**
     * Whether item photos are printed on the customer's copy. Off by default and
     * for every order predating the field — the photos are a shop-side record
     * first, and putting them on the customer's document is a separate choice.
     */
    includeItemPhotosOnBill?: boolean;
    gstRate?: number;
    subTotal?: number;
    gstAmount?: number;

    // Status
    status: OrderStatus;

    // Final settlement fields
    finalInvoiceId?: Types.ObjectId;
    completedAt?: Date;
    deletedAt: Date | null;

    createdAt: Date;
    updatedAt: Date;
}

export interface CreateOrderDTO {
    orderDate: Date;
    items: OrderItem[];
    paymentMode: PaymentMode;
    bookingRate?: number;
    includeGST?: boolean;
    isOrnamentExchanges?: boolean;
    ornamentExchanges?: OrnamentExchangeItem[];
    gstRate?: number;
    /** Print item photos on the customer's copy. Defaults to false. */
    includeItemPhotosOnBill?: boolean;
    initialPayment?: {
        amount: number;
        goldRate: number;
        notes?: string;
    };
}

export interface AddPaymentDTO {
    amount: number;
    goldRate: number;
    date?: Date;
    paymentType?: "advance" | "final";
    notes?: string;
}

export interface UpdateOrderDTO {
    items?: OrderItem[];
    status?: OrderStatus;
}
