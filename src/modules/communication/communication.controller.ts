import { Request, Response } from 'express';
import { Types } from 'mongoose';
import asyncHandler from '../../common/middlewares/asyncHandler.middleware';
import { AppError } from '../../common/errors/AppError';
import type { ApiResponse } from '../../common/types/api';
import { CommunicationService } from './communication.service';
import Admin from '../admin/admin.model';

export const CommunicationController = {
  getLogs: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid user id', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    const logs = await CommunicationService.getLogs(id);
    res.status(200).json({ success: true, data: logs });
  }),

  addLog: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    const { type, notes } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid user id', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    if (!type || !notes?.trim()) {
      throw new AppError('type and notes are required', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    if (!['call', 'whatsapp', 'note'].includes(type)) {
      throw new AppError('type must be call, whatsapp, or note', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }

    const admin = await Admin.findById(req.auth!.sub).select('phone').lean();
    const loggedBy: string = (admin as any)?.phone ?? String(req.auth!.sub);

    const log = await CommunicationService.addLog(id, loggedBy, type, notes.trim());
    res.status(201).json({ success: true, data: log, message: 'Contact logged' });
  }),

  updateLog: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id, logId } = req.params;
    const { type, notes } = req.body;

    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(logId)) {
      throw new AppError('Invalid id', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    if (type !== undefined && !['call', 'whatsapp', 'note'].includes(type)) {
      throw new AppError('type must be call, whatsapp, or note', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    if (notes !== undefined && !String(notes).trim()) {
      // An empty edit is a delete in disguise, and deleting should be explicit —
      // otherwise a cleared field silently destroys the record's only content.
      throw new AppError('notes cannot be empty', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }

    const log = await CommunicationService.updateLog(id, logId, {
      type,
      ...(notes !== undefined ? { notes: String(notes).trim() } : {}),
    });
    if (!log) {
      throw new AppError('Contact log not found', { statusCode: 404, code: 'NOT_FOUND' });
    }
    res.status(200).json({ success: true, data: log, message: 'Contact log updated' });
  }),

  deleteLog: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id, logId } = req.params;

    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(logId)) {
      throw new AppError('Invalid id', { statusCode: 400, code: 'VALIDATION_ERROR' });
    }

    const log = await CommunicationService.deleteLog(id, logId);
    if (!log) {
      throw new AppError('Contact log not found', { statusCode: 404, code: 'NOT_FOUND' });
    }
    // The log is gone, so `contactCount` on the user's stats has changed. The
    // client patches its own cache rather than refetching the whole list.
    res.status(200).json({ success: true, data: log, message: 'Contact log deleted' });
  }),
};
