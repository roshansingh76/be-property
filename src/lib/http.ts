import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodError } from "zod";

export type ApiErrorBody = {
  error: string;
  code: string;
  requestId: string;
  details?: unknown;
};

export function errorBody(
  request: FastifyRequest,
  message: string,
  code: string,
  details?: unknown,
): ApiErrorBody {
  return {
    error: message,
    code,
    requestId: request.id,
    ...(details === undefined ? {} : { details }),
  };
}

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  message: string,
  code = "REQUEST_FAILED",
  details?: unknown,
) {
  return reply.code(status).send(errorBody(request, message, code, details));
}

export function sendValidationError(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  error: ZodError,
) {
  return sendError(request, reply, 400, message, "VALIDATION_ERROR", error.flatten());
}

export function parsePage(query: { page?: string; pageSize?: string }) {
  const page = Number.isFinite(Number(query.page)) ? Math.max(Number(query.page), 1) : 1;
  const pageSize = Number.isFinite(Number(query.pageSize))
    ? Math.min(Math.max(Number(query.pageSize), 1), 100)
    : 20;
  return { page, pageSize };
}
