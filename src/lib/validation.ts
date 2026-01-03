import { z } from 'zod';

// Organization validation
export const organizationNameSchema = z
  .string()
  .trim()
  .min(1, 'Organization name is required')
  .max(100, 'Organization name must be less than 100 characters');

// User profile validation
export const fullNameSchema = z
  .string()
  .trim()
  .max(100, 'Name must be less than 100 characters')
  .optional()
  .or(z.literal(''));

// Category validation
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Category name is required')
  .max(50, 'Category name must be less than 50 characters');

export const categoryColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format');

// Rule validation
export const ruleValueSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sender'),
    value: z.string().trim().email('Invalid email address').max(255, 'Email must be less than 255 characters'),
  }),
  z.object({
    type: z.literal('domain'),
    value: z.string().trim().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Invalid domain format').max(255, 'Domain must be less than 255 characters'),
  }),
  z.object({
    type: z.literal('keyword'),
    value: z.string().trim().min(1, 'Keyword is required').max(100, 'Keyword must be less than 100 characters'),
  }),
]);

// Simple rule value validation without discriminated union for simpler usage
export const senderRuleSchema = z.string().trim().email('Invalid email address').max(255, 'Email must be less than 255 characters');
export const domainRuleSchema = z.string().trim().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Invalid domain format').max(255, 'Domain must be less than 255 characters');
export const keywordRuleSchema = z.string().trim().min(1, 'Keyword is required').max(100, 'Keyword must be less than 100 characters');

// AI settings validation
export const signatureSchema = z
  .string()
  .max(1000, 'Signature must be less than 1000 characters')
  .optional()
  .or(z.literal(''));

// Auth validation
export const emailSchema = z
  .string()
  .trim()
  .email('Invalid email address')
  .max(255, 'Email must be less than 255 characters');

export const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password must be less than 128 characters');

// Validation result type
export type ValidationResult<T> = 
  | { success: true; data: T; error?: never }
  | { success: false; error: string; data?: never };

// Helper function to validate and get error message
export function validateField<T>(
  schema: z.ZodSchema<T>,
  value: unknown
): ValidationResult<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.errors[0]?.message || 'Validation failed' };
}

// Helper to validate rule value based on type
export function validateRuleValue(ruleType: string, value: string): ValidationResult<string> {
  switch (ruleType) {
    case 'sender':
      return validateField(senderRuleSchema, value);
    case 'domain':
      return validateField(domainRuleSchema, value);
    case 'keyword':
      return validateField(keywordRuleSchema, value);
    default:
      return { success: false, error: 'Unknown rule type' };
  }
}
