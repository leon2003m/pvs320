export type PaletteIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface DeviceStatus {
  bleName?: string;
  model?: string;
  firmware?: string;
  modelAgeMs?: number | null;
  firmwareAgeMs?: number | null;
  authenticated: boolean;
  authStatus?: string;
  activeProfile?: number;
  otaActive: boolean;
  otaRemainingMs: number;
  brightness?: number;
  contrast?: number;
  enhancement?: number;
  palette?: PaletteIndex;
  lastResponse?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export interface ProfileData {
  profile: number;
  brightness: number;
  contrast: number;
  enhancement: number;
  palette: PaletteIndex;
}

export interface ProtocolMetadata {
  v: number;
  deviceName: string;
  serviceUuid: string;
  rpcUuid: string;
  stateUuid: string;
  logUuid?: string;
  operations: string[];
}

export interface RpcRequest<TArgs = Record<string, unknown>> {
  v: 2;
  type: 'request';
  id: string;
  op: string;
  args: TArgs;
}

export interface RpcSuccess<TResult = Record<string, unknown>> {
  v: 2;
  type: 'response';
  id: string;
  ok: true;
  result?: TResult;
}

export interface RpcFailure {
  v: 2;
  type: 'response';
  id: string;
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export interface StateEvent {
  v: 2;
  type: 'event';
  event: 'state';
  seq: number;
  state: DeviceStatus;
}

export interface ErrorEvent {
  v: 2;
  type: 'event';
  event: 'error';
  code: string;
  message: string;
}

export interface LogEvent {
  v: 2;
  type: 'event';
  event: 'log';
  message: string;
}

export type RpcEnvelope = RpcSuccess | RpcFailure | StateEvent | ErrorEvent | LogEvent;

export const DEFAULT_STATUS: DeviceStatus = {
  authenticated: false,
  authStatus: 'required',
  otaActive: false,
  otaRemainingMs: 0,
  lastResponse: '',
  lastErrorCode: '',
  lastErrorMessage: ''
};

export const PALETTE_NAMES: Record<PaletteIndex, string> = {
  0: 'White Hot',
  1: 'Black Hot',
  2: 'Iron',
  3: 'Red Hot',
  4: 'Green Light',
  5: 'Rainbow',
};

export const PROTOCOL_VERSION = 2;
export const SERVICE_UUID = 'b7d10000-6f2d-4f9a-9c11-2f43a0000001';
export const LEGACY_STATUS_CHAR_UUID = 'b7d10001-6f2d-4f9a-9c11-2f43a0000001';
export const LEGACY_COMMAND_CHAR_UUID = 'b7d10002-6f2d-4f9a-9c11-2f43a0000001';
export const PROTOCOL_CHAR_UUID = 'b7d10003-6f2d-4f9a-9c11-2f43a0000001';
export const RPC_CHAR_UUID = 'b7d10004-6f2d-4f9a-9c11-2f43a0000001';
export const STATE_CHAR_UUID = 'b7d10005-6f2d-4f9a-9c11-2f43a0000001';
export const LOG_CHAR_UUID = 'b7d10006-6f2d-4f9a-9c11-2f43a0000001';
export const DEVICE_NAME = 'ThermalCamera';
