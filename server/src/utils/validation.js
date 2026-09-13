import { z } from "zod";
import { AppError } from "./errors.js";

export const uuid = z.string().uuid();
export const money = z.coerce.string().regex(/^\d+(\.\d{1,2})?$/, "Use a valid currency amount");

export function validate(schema, source = "body") {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(new AppError("Please check the highlighted fields.", 400, "VALIDATION_ERROR", parsed.error.flatten()));
    }
    if (source === "query") {
      req.validatedQuery = parsed.data;
    } else {
      req[source] = parsed.data;
    }
    return next();
  };
}

export const paginationSchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).optional(),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  sort: z.string().trim().optional(),
  sort_by: z.string().trim().optional(),
  sort_direction: z.enum(["asc", "desc", "ASC", "DESC"]).optional()
}).passthrough();
