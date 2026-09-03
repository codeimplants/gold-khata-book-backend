import type { Request } from "express";

export type MulterFilesMap = {
    [fieldname: string]: Express.Multer.File[];
};

// Image fields are always scalar strings (URL / data: / <svg> / ""). They must
// never be JSON-parsed into an object — a stringified object would otherwise be
// parsed here and later cast to the literal "[object Object]" by Mongoose.
const SKIP_JSON_PARSE = new Set(["shopLogo", "shopHeader", "signature"]);

export const parseMulterPayload = <T = any>(req: Request): T => {
    const payload: any = { ...req.body };

    for (const key in payload) {
        if (SKIP_JSON_PARSE.has(key)) continue;
        if (typeof payload[key] === "string") {
            const value = payload[key].trim();
            if (
                (value.startsWith("{") && value.endsWith("}")) ||
                (value.startsWith("[") && value.endsWith("]"))
            ) {
                try {
                    payload[key] = JSON.parse(value);
                } catch { }
            }
        }
    }

    if (req.files) {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        for (const key in files) {
            payload[key] = files[key][0];
        }
    }

    return payload as T;
};

