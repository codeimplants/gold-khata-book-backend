import { InvoiceModel } from "../invoice/invoice.model";
import { PurchaseModel } from "../purchase/purchase.model";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { deriveGstFields } from "../invoice/invoice.gst";
import { AppError } from "../../common/errors/AppError";
import { Types } from "mongoose";

interface DateFilter {
    $gte?: Date;
    $lte?: Date;
}

const getDateFilter = (range: string, start?: string, end?: string) => {
    const filter: DateFilter = {};
    const now = new Date();

    if (range === "today") {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        filter.$gte = startOfDay;
        filter.$lte = new Date();
    } else if (range === "week") {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - 7);
        filter.$gte = startOfWeek;
        filter.$lte = new Date();
    } else if (range === "month") {
        const startOfMonth = new Date(now);
        startOfMonth.setDate(now.getDate() - 30);
        filter.$gte = startOfMonth;
        filter.$lte = new Date();
    } else if (range === "custom" && start && end) {
        filter.$gte = new Date(start);
        filter.$lte = new Date(end);
    }

    return Object.keys(filter).length ? filter : null;
};

// SALES REPORT

export const SalesService = {
    async getSalesReport(userId: string, range: string, startDate?: string, endDate?: string) {
        const dateFilter = getDateFilter(range, startDate, endDate);

        const match: any = {
            userId: new Types.ObjectId(userId),
        };

        if (dateFilter) {
            match.createdAt = dateFilter;
        }

        const invoices = await InvoiceModel.find(match).populate("customerId");

        const totalInvoices = invoices.length;
        const totalSales = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

        const avgOrderValue = totalInvoices > 0 ? totalSales / totalInvoices : 0;

        const uniqueCustomers = new Set(invoices.map((i) => i.customerId?.toString())).size;

        let itemsSold = 0;
        let goldCount = 0;
        let silverCount = 0;

        const customerSpendMap = new Map<string, number>();

        invoices.forEach((inv) => {
            itemsSold += inv.items.length;

            inv.items.forEach((p) => {
                if (p.itemType?.toLowerCase() === "gold") goldCount++;
                if (p.itemType?.toLowerCase() === "silver") silverCount++;
            });

            const customerId = inv.customerId?._id?.toString();
            if (customerId) {
                customerSpendMap.set(
                    customerId,
                    (customerSpendMap.get(customerId) || 0) + inv.totalAmount
                );
            }
        });

        const topCustomers = Array.from(customerSpendMap.entries())
            .map(([id, amount]) => ({
                customerId: id,
                amount,
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5);

        return {
            summary: {
                totalSales,
                totalInvoices,
                avgOrderValue,
                itemsSold,
                goldItems: goldCount,
                silverItems: silverCount,
                uniqueCustomers,
                period: range,
            },
            topCustomers,
        };
    },

    // GST REPORT (outward supplies + inward supplies/ITC + net summary)
    //
    // NOTE: deliberately different filter semantics from getSalesReport —
    // GST filing periods are based on the invoice/purchase DATE, not
    // createdAt, and trashed invoices must be excluded. Do not "unify" this
    // with the createdAt-based sales report.
    async getGstReport(userId: string, startDate: string, endDate: string) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new AppError("Invalid startDate or endDate", {
                statusCode: 400,
                code: "VALIDATION_ERROR",
            });
        }
        // Period is inclusive of the whole end day
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        const userObjectId = new Types.ObjectId(userId);

        const [shop, invoices, purchases] = await Promise.all([
            ShopDetail.findOne({ userId }).lean(),
            InvoiceModel.find({
                userId: userObjectId,
                deletedAt: null,
                invoiceDate: { $gte: start, $lte: end },
            })
                .populate("customerId")
                .lean(),
            PurchaseModel.find({
                userId: userObjectId,
                purchaseDate: { $gte: start, $lte: end },
            })
                .sort({ purchaseDate: 1 })
                .lean(),
        ]);

        const shopGstin = shop?.gstNo?.trim()
            ? shop.gstNo.trim().toUpperCase()
            : undefined;
        const shopGstRate = shop?.gstPercentage ?? 3;

        // ---- Part A: outward supplies (GST sales) ----
        const gstInvoices = invoices.filter(
            (inv: any) => inv.includeGST !== false && (inv.gstAmount ?? 0) > 0
        );

        const outwardRows = gstInvoices.map((inv: any) => {
            const derived = deriveGstFields(inv, shopGstin, shopGstRate);
            const customer = inv.customerId as any;
            return {
                invoiceId: inv._id.toString(),
                invoiceNumber: inv.invoiceNumber || "",
                invoiceDate: inv.invoiceDate,
                customerName: customer?.name || "",
                customerGstin: derived.customerGstin || "",
                billType: derived.customerGstin ? "B2B" : "B2C",
                hsnCodes: derived.hsnCodes,
                taxableValue: inv.subTotal,
                gstRate: derived.gstRate,
                cgst: derived.cgstAmount,
                sgst: derived.sgstAmount,
                igst: derived.igstAmount,
                invoiceTotal: inv.totalAmount,
                supplyType: derived.supplyType,
                placeOfSupply: derived.placeOfSupply || "",
                legacyDerived: derived.legacyDerived,
            };
        });

        // CAs file in invoice-number sequence — numeric part ascending,
        // falling back to string compare for non-standard numbers.
        outwardRows.sort((a, b) => {
            const numA = parseInt(a.invoiceNumber.replace(/\D/g, ""), 10);
            const numB = parseInt(b.invoiceNumber.replace(/\D/g, ""), 10);
            if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
            return a.invoiceNumber.localeCompare(b.invoiceNumber);
        });

        const round = (n: number) => Number(n.toFixed(2));
        const sum = (rows: any[], key: string) =>
            round(rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0));

        const outwardSummary = {
            billCount: outwardRows.length,
            b2bCount: outwardRows.filter((r) => r.billType === "B2B").length,
            b2cCount: outwardRows.filter((r) => r.billType === "B2C").length,
            taxableValue: sum(outwardRows, "taxableValue"),
            cgst: sum(outwardRows, "cgst"),
            sgst: sum(outwardRows, "sgst"),
            igst: sum(outwardRows, "igst"),
            totalTax: round(
                outwardRows.reduce((acc, r) => acc + r.cgst + r.sgst + r.igst, 0)
            ),
            invoiceTotal: sum(outwardRows, "invoiceTotal"),
        };

        const hsnMap = new Map<
            string,
            { billCount: number; taxableValue: number; cgst: number; sgst: number; igst: number }
        >();
        outwardRows.forEach((row) => {
            const key = row.hsnCodes;
            const entry =
                hsnMap.get(key) ||
                { billCount: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
            entry.billCount += 1;
            entry.taxableValue += row.taxableValue;
            entry.cgst += row.cgst;
            entry.sgst += row.sgst;
            entry.igst += row.igst;
            hsnMap.set(key, entry);
        });
        const hsnSummary = Array.from(hsnMap.entries()).map(([hsnCode, v]) => ({
            hsnCode,
            billCount: v.billCount,
            taxableValue: round(v.taxableValue),
            cgst: round(v.cgst),
            sgst: round(v.sgst),
            igst: round(v.igst),
        }));

        // ---- Part B: inward supplies (purchases / ITC) ----
        const inwardRows = purchases.map((p: any) => ({
            purchaseId: p._id.toString(),
            purchaseInvoiceNumber: p.purchaseInvoiceNumber,
            purchaseDate: p.purchaseDate,
            supplierName: p.supplierName,
            supplierGstin: p.supplierGstin || "",
            registered: Boolean(p.supplierGstin),
            hsnCode: p.hsnCode || "",
            taxableValue: p.taxableValue,
            gstRate: p.gstRate ?? null,
            cgst: p.cgstAmount ?? 0,
            sgst: p.sgstAmount ?? 0,
            igst: p.igstAmount ?? 0,
            total: round((p.taxableValue || 0) + (p.gstAmount || 0)),
            supplyType: p.supplyType || "intra",
        }));

        // ITC is generally only claimable on purchases from GST-registered
        // suppliers — unregistered rows are reported but excluded here.
        const registeredRows = inwardRows.filter((r) => r.registered);
        const eligibleItc = {
            cgst: sum(registeredRows, "cgst"),
            sgst: sum(registeredRows, "sgst"),
            igst: sum(registeredRows, "igst"),
            total: round(
                registeredRows.reduce((acc, r) => acc + r.cgst + r.sgst + r.igst, 0)
            ),
        };

        const inwardSummary = {
            purchaseCount: inwardRows.length,
            registeredCount: registeredRows.length,
            unregisteredCount: inwardRows.length - registeredRows.length,
            taxableValue: sum(inwardRows, "taxableValue"),
            cgst: sum(inwardRows, "cgst"),
            sgst: sum(inwardRows, "sgst"),
            igst: sum(inwardRows, "igst"),
            eligibleItc,
        };

        // ---- Net summary ----
        // Plain per-head arithmetic (floored at 0 per head, raw total kept).
        // GSTR-3B ITC set-off ordering is the CA's job — this supplies the
        // inputs, not the filing computation.
        const outputTax = {
            cgst: outwardSummary.cgst,
            sgst: outwardSummary.sgst,
            igst: outwardSummary.igst,
            total: outwardSummary.totalTax,
        };
        const netPayable = {
            cgst: round(Math.max(outputTax.cgst - eligibleItc.cgst, 0)),
            sgst: round(Math.max(outputTax.sgst - eligibleItc.sgst, 0)),
            igst: round(Math.max(outputTax.igst - eligibleItc.igst, 0)),
            total: round(outputTax.total - eligibleItc.total),
        };

        return {
            period: { startDate: start, endDate: end },
            shop: {
                name: shop?.shopName || "",
                gstin: shopGstin || "",
            },
            outward: {
                summary: outwardSummary,
                hsnSummary,
                rows: outwardRows,
            },
            inward: {
                summary: inwardSummary,
                rows: inwardRows,
            },
            net: {
                outputTax,
                itc: eligibleItc,
                netPayable,
            },
        };
    },

    // DASHBOARD SALES SUMMARY
    async getDashboardSalesSummary(userId: string) {
        const now = new Date();

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const userFilter = {
            userId: new Types.ObjectId(userId),
        };

        const [todayInvoices, monthInvoices, totalBills] = await Promise.all([
            InvoiceModel.find({
                ...userFilter,
                createdAt: { $gte: startOfToday, $lte: now },
            }),

            InvoiceModel.find({
                ...userFilter,
                createdAt: { $gte: startOfMonth, $lte: now },
            }),

            InvoiceModel.countDocuments(userFilter),
        ]);

        const todaySales = todayInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

        const monthlySales = monthInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

        return {
            todaySales,
            monthlySales,
            totalBills,
        };
    },
};
