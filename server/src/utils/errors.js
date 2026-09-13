export class AppError extends Error {
  constructor(message, statusCode = 500, code = "APP_ERROR", details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notFound(entity = "Resource") {
  return new AppError(`${entity} not found`, 404, "NOT_FOUND");
}
