import type {
  ActOnWorkflowStepRequest,
  CreateWorkflowTemplateRequest,
  SubmitWorkflowRequest,
  UpdateWorkflowTemplateRequest,
  WorkflowInstanceData,
  WorkflowTemplateData,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

export async function fetchWorkflowTemplates(): Promise<WorkflowTemplateData[]> {
  const response = await apiClient.get('/workflow/templates');
  return response.data.data;
}

export async function createWorkflowTemplate(payload: CreateWorkflowTemplateRequest): Promise<WorkflowTemplateData> {
  const response = await apiClient.post('/workflow/templates', payload);
  return response.data.data;
}

export async function updateWorkflowTemplate(
  id: string,
  payload: UpdateWorkflowTemplateRequest,
): Promise<WorkflowTemplateData> {
  const response = await apiClient.patch(`/workflow/templates/${id}`, payload);
  return response.data.data;
}

export async function submitWorkflow(payload: SubmitWorkflowRequest): Promise<WorkflowInstanceData> {
  const response = await apiClient.post('/workflow/instances/submit', payload);
  return response.data.data;
}

export async function fetchWorkflowInstance(id: string): Promise<WorkflowInstanceData> {
  const response = await apiClient.get(`/workflow/instances/${id}`);
  return response.data.data;
}

export async function fetchMyPendingTasks(): Promise<WorkflowInstanceData[]> {
  const response = await apiClient.get('/workflow/my-pending-tasks');
  return response.data.data;
}

export async function actOnWorkflowStep(
  id: string,
  payload: ActOnWorkflowStepRequest,
): Promise<WorkflowInstanceData> {
  const response = await apiClient.post(`/workflow/instances/${id}/act`, payload);
  return response.data.data;
}
