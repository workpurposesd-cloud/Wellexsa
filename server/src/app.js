import cors from "cors";
import express from "express";
import helmet from "helmet";
import { loadEnv } from "./config/env.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { createAccountRouter } from "./routes/account.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createCustomerRouter } from "./routes/customers.js";
import { createEnquiryRouter } from "./routes/enquiries.js";
import { createFollowupRouter } from "./routes/followups.js";
import healthRouter from "./routes/health.js";
import { createStaffRouter } from "./routes/staff.js";
import { createSalesRouter } from "./routes/sales.js";
import { createReportsRouter } from "./routes/reports.js";
import { createWebsiteRouter } from "./routes/website.js";

const SAFE_APPLICATION_ERROR_CODES = new Set([
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "PROFILE_REQUIRED",
  "PROFILE_SYNC_UNAVAILABLE",
  "PROFILE_CONFLICT",
  "ACCOUNT_INACTIVE",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "PHONE_CRYPTO_CONFIG",
  "INVALID_PHONE"
]);

export function createApp(config = loadEnv(), dependencies = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || config.corsOrigins.includes(origin));
    },
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"]
  }));

  app.use("/api", createRateLimiter());
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", createAccountRouter(dependencies));
  app.use("/api", createCatalogRouter(dependencies));
  app.use("/api", createCustomerRouter(dependencies));
  app.use("/api", createEnquiryRouter(dependencies));
  app.use("/api", createFollowupRouter(dependencies));
  app.use("/api", createStaffRouter(dependencies));
  app.use("/api", createSalesRouter(dependencies));
  app.use("/api", createReportsRouter(dependencies));
  app.use("/api", createWebsiteRouter(dependencies));
  app.use("/api", healthRouter);

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found."
      }
    });
  });

  app.use((error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const statusCode = Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode
      : 500;

    if (statusCode >= 500 && statusCode <= 599) {
      console.error("Unhandled API error", { type: error.name || "Error" });
    }

    const applicationCode = typeof error.code === "string" &&
      SAFE_APPLICATION_ERROR_CODES.has(error.code)
      ? error.code
      : "REQUEST_ERROR";

    response.status(statusCode).json({
      error: {
        code: statusCode >= 500 && statusCode <= 599 ? "INTERNAL_SERVER_ERROR" : applicationCode,
        message: statusCode >= 500 && statusCode <= 599 ? "Internal server error." : "The request could not be processed."
      }
    });
  });

  return app;
}
