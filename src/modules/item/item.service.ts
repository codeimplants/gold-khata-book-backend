import { ItemModel } from "./item.model";
import { CreateItemDTO, UpdateItemDTO } from "./item.types";

export const ItemService = {
  async createItem(userId: string, payload: CreateItemDTO) {
    return ItemModel.create({
      ...payload,
      dukandarId: userId,
    });
  },

  async getAllItems(userId: string) {
    return ItemModel.find({ dukandarId: userId }).sort({ createdAt: -1 });
  },

  async updateItem(
    itemId: string,
    dukandarId: string,
    payload: UpdateItemDTO
  ) {
    return ItemModel.findOneAndUpdate(
      { _id: itemId, dukandarId },
      payload,
      { new: true }
    );
  },

  async deleteItem(itemId: string, userId: string) {
    return ItemModel.findOneAndDelete({
      _id: itemId,
      dukandarId: userId,
    });
  },
};
