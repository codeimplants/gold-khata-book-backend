import { Types } from "mongoose";

export interface IMetalRate {
    dukandarId: Types.ObjectId;
    gold: {
        goldPrice24K: number;
        goldPrice24K995: number;
        goldPrice24K995GW: number;
        goldPrice22K: number;
        goldPrice18K: number;
        goldPrice14K: number;
    };

    silver: {
        silverPrice: number;
        silverBarPrice: number;
    };

    updatedAt: Date;
}
