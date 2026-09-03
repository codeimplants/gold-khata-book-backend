import { CounterModel } from "../models/Counter.model";

export const getNextSequence = async (id: string): Promise<number> => {
    const counter = await CounterModel.findOneAndUpdate(
        { id },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return counter.seq;
};