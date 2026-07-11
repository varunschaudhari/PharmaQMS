import { z } from 'zod';

export const createNumberingSchemeRequestSchema = z.object({
  entityType: z.string().min(1, 'entityType is required'),
  prefix: z.string().min(1, 'prefix is required'),
  useDepartmentToken: z.boolean().default(false),
  paddingWidth: z.coerce.number().int().min(1).max(10).default(3),
  yearlyReset: z.boolean().default(false),
});
export type CreateNumberingSchemeRequest = z.infer<typeof createNumberingSchemeRequestSchema>;

export const updateNumberingSchemeRequestSchema = z.object({
  prefix: z.string().min(1).optional(),
  useDepartmentToken: z.boolean().optional(),
  paddingWidth: z.coerce.number().int().min(1).max(10).optional(),
  yearlyReset: z.boolean().optional(),
});
export type UpdateNumberingSchemeRequest = z.infer<typeof updateNumberingSchemeRequestSchema>;

export const generateNumberRequestSchema = z.object({
  entityType: z.string().min(1, 'entityType is required'),
  departmentCode: z.string().min(1).optional(),
});
export type GenerateNumberRequest = z.infer<typeof generateNumberRequestSchema>;
