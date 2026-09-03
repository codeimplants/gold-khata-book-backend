import { Types } from 'mongoose';
import { CommunicationLogModel } from './communication.model';

export const CommunicationService = {
  async addLog(
    dukandarId: string,
    loggedBy: string,
    type: 'call' | 'whatsapp' | 'note',
    notes: string
  ) {
    return await CommunicationLogModel.create({
      dukandarId: new Types.ObjectId(dukandarId),
      loggedBy,
      type,
      notes,
    });
  },

  async getLogs(dukandarId: string) {
    if (!Types.ObjectId.isValid(dukandarId)) return [];
    return await CommunicationLogModel.find({ dukandarId: new Types.ObjectId(dukandarId) })
      .sort({ createdAt: -1 })
      .lean();
  },

  /**
   * Both of these are scoped by dukandarId as well as the log's own id.
   *
   * The log id alone would be enough to find the row, but then a mistyped or
   * guessed id would silently edit a different shop's contact history — and the
   * caller would see a success. Matching both means a wrong pairing returns
   * null and the caller can say so.
   */
  async updateLog(
    dukandarId: string,
    logId: string,
    patch: { type?: 'call' | 'whatsapp' | 'note'; notes?: string }
  ) {
    if (!Types.ObjectId.isValid(dukandarId) || !Types.ObjectId.isValid(logId)) return null;

    const update: Record<string, unknown> = {};
    if (patch.type) update.type = patch.type;
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (Object.keys(update).length === 0) return null;

    return await CommunicationLogModel.findOneAndUpdate(
      { _id: new Types.ObjectId(logId), dukandarId: new Types.ObjectId(dukandarId) },
      update,
      // runValidators so the notes length cap and the type enum apply to an
      // edit exactly as they do to a create.
      { new: true, runValidators: true }
    ).lean();
  },

  async deleteLog(dukandarId: string, logId: string) {
    if (!Types.ObjectId.isValid(dukandarId) || !Types.ObjectId.isValid(logId)) return null;

    return await CommunicationLogModel.findOneAndDelete({
      _id: new Types.ObjectId(logId),
      dukandarId: new Types.ObjectId(dukandarId),
    }).lean();
  },

  async getCount(dukandarId: Types.ObjectId): Promise<number> {
    return await CommunicationLogModel.countDocuments({ dukandarId });
  },

  async deleteAllForDukandar(dukandarId: string | Types.ObjectId) {
    return await CommunicationLogModel.deleteMany({ dukandarId });
  },
};
