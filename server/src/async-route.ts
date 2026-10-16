import type { RequestHandler } from "express";
/** Express 4 does not forward rejected async handlers to error middleware. */
export const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
