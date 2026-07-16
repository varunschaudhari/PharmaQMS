import { z } from 'zod';

// TRN-2: read-and-understood completion is e-signed (PLT-3) — no extra fields; the meaning is
// fixed to "Trained — read and understood" server-side.
export const completeTrainingAssignmentRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
});
export type CompleteTrainingAssignmentRequest = z.infer<typeof completeTrainingAssignmentRequestSchema>;

// TRN-6: one MCQ question — 2 to 6 options, exactly one correct answer.
const trainingAssessmentQuestionInputSchema = z
  .object({
    questionText: z.string().min(1, 'questionText is required'),
    options: z.array(z.string().min(1, 'An option cannot be empty')).min(2, 'At least 2 options are required').max(6, 'At most 6 options are allowed'),
    correctOptionIndex: z.coerce.number().int().min(0),
  })
  .refine((q) => q.correctOptionIndex < q.options.length, {
    message: 'correctOptionIndex must reference one of the options',
    path: ['correctOptionIndex'],
  });
export type TrainingAssessmentQuestionInput = z.infer<typeof trainingAssessmentQuestionInputSchema>;

// TRN-6: QA authors/edits the full question bank for one document version in one call —
// replacing the whole set is simpler and safer than a partial-question-edit API, and matches the
// "author on the document record" wording (the whole bank is one editorial unit). docNumber/
// versionLabel are supplied by the caller (the document detail page already has them in context)
// since Training only mirrors EFFECTIVE-version labels via DocumentTrainingTarget — a
// still-in-review draft version's label isn't otherwise available to the Training module without
// depending on Documents directly (CLAUDE.md).
export const upsertTrainingAssessmentRequestSchema = z.object({
  docNumber: z.string().min(1, 'docNumber is required'),
  versionLabel: z.string().min(1, 'versionLabel is required'),
  questions: z.array(trainingAssessmentQuestionInputSchema).min(1, 'At least one question is required'),
});
export type UpsertTrainingAssessmentRequest = z.infer<typeof upsertTrainingAssessmentRequestSchema>;

// TRN-6: a trainee's quiz submission — authenticated only, no e-signature (the eventual
// read-and-understood completion is what's e-signed, same as before TRN-6 existed).
export const submitTrainingAssessmentAttemptRequestSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        selectedOptionIndex: z.coerce.number().int().min(0),
      }),
    )
    .min(1, 'At least one answer is required'),
});
export type SubmitTrainingAssessmentAttemptRequest = z.infer<typeof submitTrainingAssessmentAttemptRequestSchema>;
