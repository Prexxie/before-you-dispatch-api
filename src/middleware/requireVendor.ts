import { RequestHandler } from "express";
import { vendorIdFromRequest } from "../lib/auth";

// Extends Express's Request with the logged-in vendor's id, set by this
// middleware once the session cookie has been verified.
declare module "express-serve-static-core" {
  interface Request {
    vendorId: string;
  }
}

// Guards every vendor-only route (dashboard, create order, dispatch, riders
// list). Customer and rider routes stay public: their unguessable token in
// the URL is their credential, not a login.
export const requireVendor: RequestHandler = (req, res, next) => {
  const vendorId = vendorIdFromRequest(req);
  if (!vendorId) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  req.vendorId = vendorId;
  next();
};
