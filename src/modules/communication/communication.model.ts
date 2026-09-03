import mongoose, { Schema, Document } from 'mongoose';
import { INPUT_LIMITS } from '../../common/constants/inputLimits';

export interface ICommunicationLog extends Document {
  dukandarId: mongoose.Types.ObjectId;
  loggedBy: string;
  type: 'call' | 'whatsapp' | 'note';
  notes: string;
  createdAt: Date;
}

const CommunicationLogSchema = new Schema<ICommunicationLog>(
  {
    dukandarId: { type: Schema.Types.ObjectId, ref: 'Dukandar', required: true, index: true },
    loggedBy: { type: String, required: true },
    type: { type: String, enum: ['call', 'whatsapp', 'note'], required: true },
    notes: { type: String, required: true, trim: true, maxlength: [INPUT_LIMITS.notes, `Notes cannot exceed ${INPUT_LIMITS.notes} characters`] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const CommunicationLogModel = mongoose.model<ICommunicationLog>(
  'CommunicationLog',
  CommunicationLogSchema
);
