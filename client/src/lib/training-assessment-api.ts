import type {
  SubmitTrainingAssessmentAttemptRequest,
  TrainingAssessmentAttemptResultData,
  TrainingAssessmentData,
  TrainingAssessmentForTraineeData,
  UpsertTrainingAssessmentRequest,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

// TRN-6: QA authoring/approval — training:edit/approve gated server-side.
export async function fetchTrainingAssessmentForAuthoring(documentId: string, versionId: string): Promise<TrainingAssessmentData | null> {
  const response = await apiClient.get(`/training/documents/${documentId}/versions/${versionId}/assessment`);
  return response.data.data;
}

export async function upsertTrainingAssessment(
  documentId: string,
  versionId: string,
  payload: UpsertTrainingAssessmentRequest,
): Promise<TrainingAssessmentData> {
  const response = await apiClient.put(`/training/documents/${documentId}/versions/${versionId}/assessment`, payload);
  return response.data.data;
}

export async function approveTrainingAssessment(documentId: string, versionId: string): Promise<TrainingAssessmentData> {
  const response = await apiClient.post(`/training/documents/${documentId}/versions/${versionId}/assessment/approve`);
  return response.data.data;
}

// TRN-6: trainee-facing quiz — own-assignment only (asserted server-side).
export async function fetchTrainingAssessmentForTrainee(assignmentId: string): Promise<TrainingAssessmentForTraineeData | null> {
  const response = await apiClient.get(`/training/assignments/${assignmentId}/assessment`);
  return response.data.data;
}

export async function submitTrainingAssessmentAttempt(
  assignmentId: string,
  payload: SubmitTrainingAssessmentAttemptRequest,
): Promise<TrainingAssessmentAttemptResultData> {
  const response = await apiClient.post(`/training/assignments/${assignmentId}/assessment/attempts`, payload);
  return response.data.data;
}
