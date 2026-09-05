import { Types } from "mongoose";

export interface InvoiceItem {
  name: string;
  huid: string;
  pieces: number;
  itemType: string;
  purity: string | number;
  grossWeight: number;
  lessWeight: number;
  netWeight: number;
  rate: number;
  makingType: string;
  makingCharge?: number;
  chargeDescription: string;
  chargeAmount: number;
  discountType: string;
  discount: number;
  // Absent on invoices created before the GST extension; service stamps
  // "7113" (jewellery) on new invoices.
  hsnCode?: string;
  /**
   * Optional photos of the item SOLD, so a shopkeeper can see months later
   * which piece went to which customer. Distinct from `Invoice.ornamentPhotos`,
   * which are the old ornaments taken IN against the same bill.
   */
  photos?: { url: string; fileId: string }[];
}

export interface InvoiceAdvancePayment {
  date: Date;
  amount: number;
  goldRate: number;
  weightCovered: number;
  paymentType?: "advance" | "final";
  notes?: string;
}

export interface Invoice {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  customerId: Types.ObjectId;
  dukandarId?: Types.ObjectId;
  orderId?: Types.ObjectId;

  invoiceDate: Date;
  invoiceNumber: string;
  items: InvoiceItem[];


  includeGST: boolean;

  subTotal: number;
  gstAmount: number;
  totalAmount: number;

  // GST breakdown — server-computed at creation from shop/customer GSTIN
  // state codes. Absent on invoices created before the GST extension
  // (reports derive them via invoice.gst.ts).
  gstRate?: number; // snapshot of shop gstPercentage at creation, e.g. 3
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  shopGstin?: string; // snapshot of shop gstNo at creation
  customerGstin?: string; // present => B2B invoice
  supplyType?: "intra" | "inter";
  placeOfSupply?: string; // 2-digit GST state code

  // Absent on invoices created via advance-order completion, which has no
  // payment-method concept — present on direct (Full payment) invoices.
  paymentMethod?: "cash" | "online";
  onlinePaymentType?: "upi" | "bank_transfer" | "cheque" | "card" | "other";

  // Snapshot of the source Order's advance-payment history at completion
  // time. Empty for manually-created (non-order) invoices.
  advancePayments: InvoiceAdvancePayment[];

  /** Photos of the old ornaments taken in against this invoice. */
  ornamentPhotos?: { url: string; fileId: string }[];

  /**
   * Whether item photos are printed on the customer's bill. Defaults to false
   * and stays false for every invoice that predates the field: the photos are
   * a shop-side record of what was sold, and putting them on the document a
   * customer receives is a separate, deliberate choice.
   */
  includeItemPhotosOnBill?: boolean;

  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvoiceDTO {
  invoiceDate: string | Date;
  invoiceNumber?: string;
  items: Omit<InvoiceItem, "netWeight">[];
  includeGST: boolean;
  gstAmount: number;
  subTotal: number;
  totalAmount: number;
  // Client-suppliable GST inputs; splits/snapshots are server-computed.
  gstRate?: number;
  customerGstin?: string;
  // Required end-to-end for the direct create-invoice (Full payment) flow —
  // createInvoiceSchema enforces that at the HTTP boundary. Optional here
  // because the advance-order "complete" flow also builds a CreateInvoiceDTO
  // (via unifiedCompleteOrderSchema, which has no payment-method concept)
  // and doesn't set it.
  paymentMethod?: "cash" | "online";
  onlinePaymentType?: "upi" | "bank_transfer" | "cheque" | "card" | "other";
  orderId?: string;
  // Populated internally by OrderService.unifiedCompleteAdvanceOrder from
  // order.payments — never sent by the public create-invoice HTTP route.
  payments?: InvoiceAdvancePayment[];
  /**
   * Old ornaments taken in against the order this invoice settles. Internal
   * only, like `payments` above - the public create-invoice route never sends
   * it, because at creation there is no invoice id to upload against yet. The
   * advance-settlement path carries it over from the order so the final bill
   * does not lose what the order recorded.
   */
  ornamentPhotos?: { url: string; fileId: string }[];
  /** Print item photos on the customer's bill. Defaults to false. */
  includeItemPhotosOnBill?: boolean;
}

export interface UpdateInvoiceDTO {
  invoiceDate?: string | Date;
  invoiceNumber?: string;
  items?: Omit<InvoiceItem, "netWeight">[];
  includeGST?: boolean;
  gstAmount?: number;
  subTotal?: number;
  totalAmount?: number;
  gstRate?: number;
  customerGstin?: string;
  paymentMethod?: "cash" | "online";
  onlinePaymentType?: "upi" | "bank_transfer" | "cheque" | "card" | "other";
  includeItemPhotosOnBill?: boolean;
}