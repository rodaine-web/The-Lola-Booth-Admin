import { AppError } from "../utils/errors.js";

export function errorHandler(error, req, res, _next) {
  req.log?.error({ err: error }, "request failed");

  if (error.name === 'ZodError') return res.status(422).json({error:{code:'VALIDATION_ERROR',message:'Please check the submitted fields.',details:error.issues,requestId:req.id}});
  if (error.code === '23505') return res.status(409).json({error:{code:'DUPLICATE_RECORD',message:'A record with those details already exists.',requestId:req.id}});
  if (error.code === '22P02') return res.status(422).json({error:{code:'VALIDATION_ERROR',message:'A supplied identifier or value is invalid.',requestId:req.id}});
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
