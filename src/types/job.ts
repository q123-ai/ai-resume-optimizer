import { z } from "zod";
import { sourcedTextSchema } from "./resume";

export const jobSourcedTextSchema = sourcedTextSchema.extend({
  value: z.string().min(1).max(500),
  sourceText: z.string().min(1).max(2_000),
});
const optionalText = jobSourcedTextSchema.nullable().default(null);
const list = z.array(jobSourcedTextSchema).default([]);
export const jobRequirementSchema = jobSourcedTextSchema.extend({
  priority: z.enum(["required", "preferred", "unspecified"]),
});

// AI output excludes rawText; the server owns the original text snapshot.
export const jobExtractionSchema = z.strictObject({
  jobTitle: optionalText,
  companyName: optionalText,
  location: optionalText,
  employmentType: optionalText,
  salary: optionalText,
  responsibilities: list,
  requiredSkills: list,
  preferredSkills: list,
  unspecifiedSkills: list,
  educationRequirements: z.array(jobRequirementSchema).default([]),
  experienceRequirements: z.array(jobRequirementSchema).default([]),
  certifications: z.array(jobRequirementSchema).default([]),
  languageRequirements: z.array(jobRequirementSchema).default([]),
  otherRequirements: z.array(jobRequirementSchema).default([]),
  keywords: list,
});

export const jobDataSchema = jobExtractionSchema.extend({ rawText: z.string().min(1) });
export type JobExtraction = z.infer<typeof jobExtractionSchema>;
export type JobData = z.infer<typeof jobDataSchema>;
