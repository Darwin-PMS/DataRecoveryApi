import { z } from "zod";

export const createJobSchema = {
  body: {
    type: "object",
    required: ["name", "type"],
    properties: {
      name: { type: "string", minLength: 1 },
      description: { type: "string" },
      type: {
        type: "string",
        enum: [
          "QUICK_SCAN",
          "DEEP_SCAN",
          "SIGNATURE_SCAN",
          "CARVING",
          "RAID_RECOVERY",
          "PARTITION_RECOVERY",
          "FORENSIC",
        ],
      },
      sourceType: {
        type: "string",
        enum: ["UPLOAD", "AGENT", "CLOUD"],
        default: "UPLOAD",
      },
      sourceId: { type: "string" },
      settings: { type: "object" },
    },
  },
};

export const createJobZodSchema = z.object({
  name: z.string().min(1, "Job name is required"),
  description: z.string().optional(),
  type: z.enum([
    "QUICK_SCAN",
    "DEEP_SCAN",
    "SIGNATURE_SCAN",
    "CARVING",
    "RAID_RECOVERY",
    "PARTITION_RECOVERY",
    "FORENSIC",
  ]),
  sourceType: z.enum(["UPLOAD", "AGENT", "CLOUD"]).default("UPLOAD"),
  sourceId: z.string().optional(),
  settings: z.object({}).passthrough().optional(),
});

export const updateJobZodSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  settings: z.object({}).passthrough().optional(),
});

export const jobQueryZodSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z
    .enum([
      "PENDING",
      "QUEUED",
      "SCANNING",
      "PAUSED",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ])
    .optional(),
  type: z
    .enum([
      "QUICK_SCAN",
      "DEEP_SCAN",
      "SIGNATURE_SCAN",
      "CARVING",
      "RAID_RECOVERY",
      "PARTITION_RECOVERY",
      "FORENSIC",
    ])
    .optional(),
  search: z.string().optional(),
});
