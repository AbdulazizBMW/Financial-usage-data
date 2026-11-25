import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { money, isValidDate } from './money.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'You must sign in to continue.') => new HttpError(401, message);
export const forbidden = (message = 'You do not have access to this resource.') => new HttpError(403, message);
export const notFound = (message = 'Record not found.') => new HttpError(404, message);

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function body<T = Record<string, unknown>>(req: Request): T {
  return (req.body ?? {}) as T;
}

export function str(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; optional?: boolean; trim?: boolean } = {}
): string {
  const { min = 1, max = 500, optional = false, trim = true } = opts;
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    throw badRequest(`${field} is required.`);
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  const out = trim ? value.trim() : value;
  if (out.length < min) throw badRequest(`${field} must be at least ${min} characters.`);
  if (out.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return out;
}

export function amount(value: unknown, field = 'Amount'): string {
  if (value === undefined || value === null || value === '') throw badRequest(`${field} is required.`);
  const raw = typeof value === 'number' ? String(value) : String(value).replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw badRequest(`${field} must be a valid number.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw badRequest(`${field} must be a valid number.`);
  if (Math.abs(parsed) > 1e15) throw badRequest(`${field} is too large.`);
  return money(raw);
}

export function positiveAmount(value: unknown, field = 'Amount'): string {
  const out = amount(value, field);
  if (Number(out) <= 0) throw badRequest(`${field} must be greater than zero.`);
  return out;
}

export function positiveRate(value: unknown, field = 'Exchange rate'): string {
  const out = amount(value, field);
  if (Number(out) <= 0) throw badRequest(`${field} must be greater than zero.`);
  return out;
}

export function date(value: unknown, field = 'Date'): string {
  if (!isValidDate(value)) throw badRequest(`${field} must be a valid date (YYYY-MM-DD).`);
  return value;
}

export function optionalDate(value: unknown, field = 'Date'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return date(value, field);
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function uuid(value: unknown, field = 'Identifier'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw badRequest(`${field} is invalid.`);
  }
  return value;
}

export function optionalUuid(value: unknown, field = 'Identifier'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, field);
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
