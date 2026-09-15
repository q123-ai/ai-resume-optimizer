import { z } from "zod";

// Values are extracted facts; sourceText is an unchanged excerpt of rawText.
export const sourcedTextSchema = z.strictObject({
  value: z.string().min(1),
  sourceText: z.string().min(1),
});
const optionalText = sourcedTextSchema.nullable();
const description = z.array(sourcedTextSchema);
const id = z.uuid();

const educationSchema = z.strictObject({
  school: optionalText,
  degree: optionalText,
  major: optionalText,
  startDate: optionalText,
  endDate: optionalText,
  description,
});
const experienceSchema = z.strictObject({
  company: optionalText,
  position: optionalText,
  startDate: optionalText,
  endDate: optionalText,
  location: optionalText,
  description,
});
const projectSchema = z.strictObject({
  name: optionalText,
  role: optionalText,
  startDate: optionalText,
  endDate: optionalText,
  description,
  technologies: z.array(sourcedTextSchema),
});
const skillSchema = z.strictObject({
  name: sourcedTextSchema,
  // An organizational label, not a claim about proficiency.
  category: z.string().nullable(),
  description: optionalText,
});
const certificateSchema = z.strictObject({
  name: optionalText,
  issuer: optionalText,
  date: optionalText,
  description,
});
const otherSchema = z.strictObject({
  // A display heading; the factual content is separately sourced.
  title: z.string().nullable(),
  content: sourcedTextSchema,
});

// Future AI extraction output: no rawText or program-owned IDs.
export const resumeExtractionSchema = z.strictObject({
  personalInfo: z.strictObject({
    name: optionalText,
    phone: optionalText,
    email: optionalText,
    location: optionalText,
    website: optionalText,
    linkedin: optionalText,
    github: optionalText,
    other: z.array(sourcedTextSchema),
  }),
  summary: optionalText,
  education: z.array(educationSchema),
  experience: z.array(experienceSchema),
  projects: z.array(projectSchema),
  skills: z.array(skillSchema),
  certificates: z.array(certificateSchema),
  other: z.array(otherSchema),
});

export const resumeDataSchema = resumeExtractionSchema.extend({
  rawText: z.string().min(1),
  education: z.array(educationSchema.extend({ id })),
  experience: z.array(experienceSchema.extend({ id })),
  projects: z.array(projectSchema.extend({ id })),
  skills: z.array(skillSchema.extend({ id })),
  certificates: z.array(certificateSchema.extend({ id })),
  other: z.array(otherSchema.extend({ id })),
});

export type SourcedText = z.infer<typeof sourcedTextSchema>;
export type ResumeExtraction = z.infer<typeof resumeExtractionSchema>;
export type ResumeData = z.infer<typeof resumeDataSchema>;
