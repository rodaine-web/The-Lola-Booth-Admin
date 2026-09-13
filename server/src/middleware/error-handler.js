import { AppError } from "../utils/errors.js";

export function errorHandler(error, req, res, _next) {
  req.log?.error({ err: error }, "request failed");

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: req.id
      }
    });
  }

  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
      requestId: req.id
    }
  });
}
