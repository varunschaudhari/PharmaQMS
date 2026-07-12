import type { TrainingAssignmentData, TrainingMatrixEntryData } from '@pharmaqms/shared';
import { apiClient } from './api-client';

export async function fetchMyTrainingAssignments(): Promise<TrainingAssignmentData[]> {
  const response = await apiClient.get('/training/my-assignments');
  return response.data.data;
}

export async function completeTrainingAssignment(id: string, signingToken: string): Promise<TrainingAssignmentData> {
  const response = await apiClient.post(`/training/assignments/${id}/complete`, { signingToken });
  return response.data.data;
}

export async function fetchTrainingMatrix(): Promise<TrainingMatrixEntryData[]> {
  const response = await apiClient.get('/training/matrix');
  return response.data.data;
}

export async function fetchOverdueTraining(): Promise<TrainingAssignmentData[]> {
  const response = await apiClient.get('/training/overdue');
  return response.data.data;
}

export async function fetchEmployeeTrainingRecord(userId: string): Promise<TrainingAssignmentData[]> {
  const response = await apiClient.get(`/training/employees/${userId}/record`);
  return response.data.data;
}

export async function downloadEmployeeTrainingRecordPdf(userId: string): Promise<void> {
  const response = await apiClient.get(`/training/employees/${userId}/record.pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `training-record-${userId}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
