import type {
  CalibrationDueEntryData,
  CalibrationRecordData,
  CalibrationScheduleData,
  CleaningType,
  CreateCalibrationScheduleRequest,
  CreateEquipmentRequest,
  DispositionCalibrationRequest,
  EquipmentData,
  EquipmentStatus,
  EquipmentStatusCardData,
  LogbookEntryData,
  MaintenanceTaskData,
  PaginationMeta,
  PmPlanData,
  PmTaskData,
  QualificationRecordData,
  QualificationResult,
  QualificationType,
  TransitionEquipmentStatusRequest,
  UpdateEquipmentRequest,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

export interface EquipmentListResponse {
  data: EquipmentData[];
  meta: PaginationMeta;
}

export async function fetchEquipmentList(options?: {
  page?: number;
  limit?: number;
  status?: EquipmentStatus;
  departmentId?: string;
  search?: string;
}): Promise<EquipmentListResponse> {
  const response = await apiClient.get('/equipment', {
    params: {
      page: options?.page ?? 1,
      limit: options?.limit ?? 20,
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
      ...(options?.search ? { search: options.search } : {}),
    },
  });
  return response.data;
}

export async function fetchEquipment(id: string): Promise<EquipmentData> {
  const response = await apiClient.get(`/equipment/${id}`);
  return response.data.data;
}

export async function createEquipment(payload: CreateEquipmentRequest): Promise<EquipmentData> {
  const response = await apiClient.post('/equipment', payload);
  return response.data.data;
}

export async function updateEquipment(id: string, payload: UpdateEquipmentRequest): Promise<EquipmentData> {
  const response = await apiClient.patch(`/equipment/${id}`, payload);
  return response.data.data;
}

export async function transitionEquipmentStatus(
  id: string,
  payload: TransitionEquipmentStatusRequest,
): Promise<EquipmentData> {
  const response = await apiClient.post(`/equipment/${id}/status`, payload);
  return response.data.data;
}

export async function fetchEquipmentStatusCard(id: string): Promise<EquipmentStatusCardData> {
  const response = await apiClient.get(`/equipment/${id}/status-card`);
  return response.data.data;
}

// EQP-2: label PDFs are JWT-authenticated (not public), so a plain <a href> can't carry the
// bearer token — fetch as a blob through the authenticated client instead.
export async function downloadEquipmentLabel(code: string, size: 'single' | 'a4'): Promise<void> {
  const response = await apiClient.get(`/qr/codes/${code}/label.pdf`, { params: { size }, responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qr-label-${code}-${size}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// EQP-4: calibration schedule (one active schedule per equipment).
export async function fetchCalibrationSchedule(equipmentId: string): Promise<CalibrationScheduleData | null> {
  const response = await apiClient.get(`/equipment/${equipmentId}/calibration-schedule`);
  return response.data.data;
}

export async function upsertCalibrationSchedule(
  equipmentId: string,
  payload: CreateCalibrationScheduleRequest,
): Promise<CalibrationScheduleData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/calibration-schedule`, payload);
  return response.data.data;
}

export async function fetchCalibrationRecords(equipmentId: string): Promise<CalibrationRecordData[]> {
  const response = await apiClient.get(`/equipment/${equipmentId}/calibration-records`);
  return response.data.data;
}

export interface RecordCalibrationResultInput {
  performedDate: string;
  result: 'pass' | 'fail';
  toleranceNotes?: string;
  impactAssessmentNote?: string;
  file: File;
}

export async function recordCalibrationResult(
  equipmentId: string,
  input: RecordCalibrationResultInput,
): Promise<CalibrationRecordData> {
  const form = new FormData();
  form.append('performedDate', input.performedDate);
  form.append('result', input.result);
  if (input.toleranceNotes) form.append('toleranceNotes', input.toleranceNotes);
  if (input.impactAssessmentNote) form.append('impactAssessmentNote', input.impactAssessmentNote);
  form.append('file', input.file);
  const response = await apiClient.post(`/equipment/${equipmentId}/calibration-records`, form);
  return response.data.data;
}

export async function verifyCalibrationRecord(
  equipmentId: string,
  recordId: string,
  signingToken: string,
): Promise<CalibrationRecordData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/calibration-records/${recordId}/verify`, { signingToken });
  return response.data.data;
}

export async function dispositionCalibrationRecord(
  equipmentId: string,
  recordId: string,
  payload: DispositionCalibrationRequest,
): Promise<CalibrationRecordData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/calibration-records/${recordId}/disposition`, payload);
  return response.data.data;
}

export async function fetchCalibrationDue(): Promise<CalibrationDueEntryData[]> {
  const response = await apiClient.get('/equipment/calibration/due');
  return response.data.data;
}

// EQP-6: the digital logbook. Every logging call needs only authentication (the scan itself is
// the access control).
export async function logUsageStart(equipmentId: string, productBatchRef: string): Promise<LogbookEntryData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/logbook/usage-start`, { productBatchRef });
  return response.data.data;
}

export async function logUsageStop(equipmentId: string, productBatchRef?: string): Promise<LogbookEntryData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/logbook/usage-stop`, { productBatchRef });
  return response.data.data;
}

export async function logCleaning(equipmentId: string, cleaningType: CleaningType): Promise<LogbookEntryData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/logbook/cleaning`, { cleaningType });
  return response.data.data;
}

export async function logBreakdown(
  equipmentId: string,
  description: string,
  photo?: File,
): Promise<{ entry: LogbookEntryData; maintenanceTask: MaintenanceTaskData }> {
  const form = new FormData();
  form.append('description', description);
  if (photo) form.append('photo', photo);
  const response = await apiClient.post(`/equipment/${equipmentId}/logbook/breakdown`, form);
  return response.data.data;
}

export async function createLogbookAmendment(
  equipmentId: string,
  amendsEntryId: string,
  description: string,
): Promise<LogbookEntryData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/logbook/${amendsEntryId}/amend`, { amendsEntryId, description });
  return response.data.data;
}

export async function fetchLogbook(equipmentId: string): Promise<LogbookEntryData[]> {
  const response = await apiClient.get(`/equipment/${equipmentId}/logbook`);
  return response.data.data;
}

// EQP-6: the photo endpoint is JWT-authenticated — fetch as a blob and open it, same pattern as
// downloadEquipmentLabel (a plain <a>/<img> can't carry the bearer token).
export async function openLogbookPhoto(equipmentId: string, entryId: string): Promise<void> {
  const response = await apiClient.get(`/equipment/${equipmentId}/logbook/${entryId}/photo`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// EQP-7: maintenance tasks.
export async function fetchMaintenanceTasksForEquipment(equipmentId: string): Promise<MaintenanceTaskData[]> {
  const response = await apiClient.get(`/equipment/${equipmentId}/maintenance-tasks`);
  return response.data.data;
}

export async function fetchOpenMaintenanceTasks(): Promise<MaintenanceTaskData[]> {
  const response = await apiClient.get('/equipment/maintenance-tasks/open');
  return response.data.data;
}

export async function closeMaintenanceTask(taskId: string, completionNote: string): Promise<MaintenanceTaskData> {
  const response = await apiClient.post(`/equipment/maintenance-tasks/${taskId}/close`, { completionNote });
  return response.data.data;
}

export async function verifyMaintenanceTask(taskId: string, signingToken: string, note?: string): Promise<MaintenanceTaskData> {
  const response = await apiClient.post(`/equipment/maintenance-tasks/${taskId}/verify`, { signingToken, note });
  return response.data.data;
}

// EQP-8: qualification records (IQ/OQ/PQ/REQUALIFICATION).
export async function fetchQualificationRecords(equipmentId: string): Promise<QualificationRecordData[]> {
  const response = await apiClient.get(`/equipment/${equipmentId}/qualification-records`);
  return response.data.data;
}

export interface RecordQualificationInput {
  qualificationType: QualificationType;
  performedDate: string;
  result: QualificationResult;
  notes?: string;
  requalificationFrequencyMonths?: number;
  protocol: File;
  report?: File;
}

export async function recordQualification(equipmentId: string, input: RecordQualificationInput): Promise<QualificationRecordData> {
  const form = new FormData();
  form.append('qualificationType', input.qualificationType);
  form.append('performedDate', input.performedDate);
  form.append('result', input.result);
  if (input.notes) form.append('notes', input.notes);
  if (input.requalificationFrequencyMonths) form.append('requalificationFrequencyMonths', String(input.requalificationFrequencyMonths));
  form.append('protocol', input.protocol);
  if (input.report) form.append('report', input.report);
  const response = await apiClient.post(`/equipment/${equipmentId}/qualification-records`, form);
  return response.data.data;
}

export async function attachQualificationReport(equipmentId: string, recordId: string, report: File): Promise<QualificationRecordData> {
  const form = new FormData();
  form.append('report', report);
  const response = await apiClient.post(`/equipment/${equipmentId}/qualification-records/${recordId}/report`, form);
  return response.data.data;
}

// EQP-8: protocol/report are JWT-authenticated — fetch as a blob and open, same pattern as
// openLogbookPhoto/downloadEquipmentLabel.
export async function openQualificationFile(equipmentId: string, recordId: string, fileType: 'protocol' | 'report'): Promise<void> {
  const response = await apiClient.get(`/equipment/${equipmentId}/qualification-records/${recordId}/${fileType}`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// EQP-9: preventive-maintenance plans/tasks.
export async function fetchPmPlan(equipmentId: string): Promise<PmPlanData | null> {
  const response = await apiClient.get(`/equipment/${equipmentId}/pm-plan`);
  return response.data.data;
}

export async function upsertPmPlan(
  equipmentId: string,
  payload: { frequencyMonths: number; checklistText: string; nextDueDate: string },
): Promise<PmPlanData> {
  const response = await apiClient.post(`/equipment/${equipmentId}/pm-plan`, payload);
  return response.data.data;
}

export async function fetchPmTasksForEquipment(equipmentId: string): Promise<PmTaskData[]> {
  const response = await apiClient.get(`/equipment/${equipmentId}/pm-tasks`);
  return response.data.data;
}

export async function fetchOpenPmTasks(): Promise<PmTaskData[]> {
  const response = await apiClient.get('/equipment/pm-tasks/open');
  return response.data.data;
}

export async function completePmTask(taskId: string, signingToken: string, completionNote: string): Promise<PmTaskData> {
  const response = await apiClient.post(`/equipment/pm-tasks/${taskId}/complete`, { signingToken, completionNote });
  return response.data.data;
}

// EQP-10: full-lifecycle equipment history PDF — JWT-authenticated, same blob-fetch pattern as
// downloadEquipmentLabel/openLogbookPhoto.
export async function downloadEquipmentHistoryReport(equipmentId: string): Promise<void> {
  const response = await apiClient.get(`/equipment/${equipmentId}/history-report.pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `equipment-history-${equipmentId}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
