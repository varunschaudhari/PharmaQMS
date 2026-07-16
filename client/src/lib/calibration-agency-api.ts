import type {
  CalibrationAgencyData,
  CalibrationAgencyStatus,
  CalibrationCertificateRegistryEntryData,
  CalibrationDueByAgencyEntryData,
  CreateCalibrationAgencyRequest,
  UpdateCalibrationAgencyRequest,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

export async function fetchCalibrationAgencies(): Promise<CalibrationAgencyData[]> {
  const response = await apiClient.get('/equipment/calibration-agencies');
  return response.data.data;
}

export async function fetchCalibrationAgency(id: string): Promise<CalibrationAgencyData> {
  const response = await apiClient.get(`/equipment/calibration-agencies/${id}`);
  return response.data.data;
}

export async function createCalibrationAgency(payload: CreateCalibrationAgencyRequest): Promise<CalibrationAgencyData> {
  const response = await apiClient.post('/equipment/calibration-agencies', payload);
  return response.data.data;
}

export async function updateCalibrationAgency(id: string, payload: UpdateCalibrationAgencyRequest): Promise<CalibrationAgencyData> {
  const response = await apiClient.patch(`/equipment/calibration-agencies/${id}`, payload);
  return response.data.data;
}

export async function transitionCalibrationAgencyStatus(id: string, status: CalibrationAgencyStatus): Promise<CalibrationAgencyData> {
  const response = await apiClient.post(`/equipment/calibration-agencies/${id}/status`, { status });
  return response.data.data;
}

export async function uploadCalibrationAgencyCertificate(id: string, file: File): Promise<CalibrationAgencyData> {
  const form = new FormData();
  form.append('file', file);
  const response = await apiClient.post(`/equipment/calibration-agencies/${id}/certificates`, form);
  return response.data.data;
}

// EQP-11: accreditation certificates are JWT-authenticated — fetch as a blob and open, same
// pattern as openLogbookPhoto/downloadEquipmentLabel.
export async function openCalibrationAgencyCertificate(agencyId: string, certificateId: string): Promise<void> {
  const response = await apiClient.get(`/equipment/calibration-agencies/${agencyId}/certificates/${certificateId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function fetchCalibrationDueByAgency(): Promise<CalibrationDueByAgencyEntryData[]> {
  const response = await apiClient.get('/equipment/calibration-agencies/due');
  return response.data.data;
}

export async function downloadCalibrationDueByAgencyCsv(): Promise<void> {
  const response = await apiClient.get('/equipment/calibration-agencies/due.csv', { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'calibration-due-by-agency.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadCalibrationDueByAgencyPdf(): Promise<void> {
  const response = await apiClient.get('/equipment/calibration-agencies/due.pdf', { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'calibration-due-by-agency.pdf';
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function fetchCalibrationCertificateRegistry(filters?: {
  agencyId?: string;
  equipmentId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<CalibrationCertificateRegistryEntryData[]> {
  const response = await apiClient.get('/equipment/calibration-agencies/certificates', { params: filters });
  return response.data.data;
}

// EQP-11 (e): open the calibration certificate itself from a registry row.
export async function openCalibrationRecordCertificate(equipmentId: string, recordId: string): Promise<void> {
  const response = await apiClient.get(`/equipment/${equipmentId}/calibration-records/${recordId}/certificate`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
