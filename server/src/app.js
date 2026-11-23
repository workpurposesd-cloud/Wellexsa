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
      error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;

    if (statusCode === 500) {
      console.error("Unhandled API error", { type: error.name || "Error" });
    }

    response.status(statusCode).json({
      error: {
        code: statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR",
        message: statusCode === 500 ? "Internal server error." : "The request could not be processed."
      }
    });
  });

  return app;
}
