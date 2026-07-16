import type {
  CleaningType,
  CreateRoomRequest,
  PaginationMeta,
  RoomCleaningDueEntryData,
  RoomCleaningEntryData,
  RoomCleaningScheduleData,
  RoomData,
  RoomStatus,
  RoomStatusCardData,
  TransitionRoomStatusRequest,
  UpdateRoomRequest,
  UpsertRoomCleaningScheduleRequest,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

export interface RoomListResponse {
  data: RoomData[];
  meta: PaginationMeta;
}

export async function fetchRoomList(options?: {
  page?: number;
  limit?: number;
  status?: RoomStatus;
  search?: string;
}): Promise<RoomListResponse> {
  const response = await apiClient.get('/rooms', {
    params: {
      page: options?.page ?? 1,
      limit: options?.limit ?? 20,
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.search ? { search: options.search } : {}),
    },
  });
  return response.data;
}

export async function fetchRoom(id: string): Promise<RoomData> {
  const response = await apiClient.get(`/rooms/${id}`);
  return response.data.data;
}

export async function createRoom(payload: CreateRoomRequest): Promise<RoomData> {
  const response = await apiClient.post('/rooms', payload);
  return response.data.data;
}

export async function updateRoom(id: string, payload: UpdateRoomRequest): Promise<RoomData> {
  const response = await apiClient.patch(`/rooms/${id}`, payload);
  return response.data.data;
}

export async function transitionRoomStatus(id: string, payload: TransitionRoomStatusRequest): Promise<RoomData> {
  const response = await apiClient.post(`/rooms/${id}/status`, payload);
  return response.data.data;
}

export async function fetchRoomStatusCard(id: string): Promise<RoomStatusCardData> {
  const response = await apiClient.get(`/rooms/${id}/status-card`);
  return response.data.data;
}

// QRX-1: room cleaning schedule (one active schedule per room).
export async function fetchRoomCleaningSchedule(roomId: string): Promise<RoomCleaningScheduleData | null> {
  const response = await apiClient.get(`/rooms/${roomId}/cleaning-schedule`);
  return response.data.data;
}

export async function upsertRoomCleaningSchedule(
  roomId: string,
  payload: UpsertRoomCleaningScheduleRequest,
): Promise<RoomCleaningScheduleData> {
  const response = await apiClient.post(`/rooms/${roomId}/cleaning-schedule`, payload);
  return response.data.data;
}

// QRX-1: the digital cleaning log. Logging needs only authentication — the scan itself is the
// access control (same as EQP-6's logbook).
export async function logRoomCleaning(roomId: string, cleaningType: CleaningType, remarks?: string): Promise<RoomCleaningEntryData> {
  const response = await apiClient.post(`/rooms/${roomId}/cleaning-entries`, { cleaningType, remarks });
  return response.data.data;
}

export async function createRoomCleaningAmendment(
  roomId: string,
  amendsEntryId: string,
  description: string,
): Promise<RoomCleaningEntryData> {
  const response = await apiClient.post(`/rooms/${roomId}/cleaning-entries/${amendsEntryId}/amend`, { amendsEntryId, description });
  return response.data.data;
}

export async function fetchRoomCleaningEntries(roomId: string): Promise<RoomCleaningEntryData[]> {
  const response = await apiClient.get(`/rooms/${roomId}/cleaning-entries`);
  return response.data.data;
}

export async function fetchRoomCleaningDue(): Promise<RoomCleaningDueEntryData[]> {
  const response = await apiClient.get('/rooms/cleaning/due');
  return response.data.data;
}

// QRX-1: label PDFs are JWT-authenticated — fetch as a blob, same pattern as downloadEquipmentLabel.
export async function downloadRoomLabel(code: string, size: 'single' | 'a4'): Promise<void> {
  const response = await apiClient.get(`/qr/codes/${code}/label.pdf`, { params: { size }, responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qr-label-${code}-${size}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
