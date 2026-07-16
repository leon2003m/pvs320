import {
  DEFAULT_STATUS,
  DEVICE_NAME,
  DeviceStatus,
  LOG_CHAR_UUID,
  PROTOCOL_CHAR_UUID,
  PROTOCOL_VERSION,
  ProtocolMetadata,
  RPC_CHAR_UUID,
  RpcEnvelope,
  STATE_CHAR_UUID,
  SERVICE_UUID,
  ProfileData,
  PaletteIndex,
} from '../types';

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface BLELog {
  type: 'send' | 'receive' | 'error' | 'info';
  message: string;
  timestamp: number;
}

const SERVER_LOG_ENDPOINT = '/__logs/ble';
const MIN_ACCEPTABLE_RSSI = -85;
const SERVER_LOGGING_KEY = 'ble_server_logging_enabled';
const SAVED_PASSWORDS_KEY = 'ble_saved_passwords';
const DEVICE_PREFS_KEY = 'ble_device_prefs';

interface SavedPasswordEntry {
  password: string;
  name?: string;
}

// Never log/mirror secrets in cleartext (password ops go to the debug console
// and the server log sink).
const SECRET_OPS = new Set(['auth.login', 'device.setPassword']);
function redactArgs(op: string, args: Record<string, unknown>): Record<string, unknown> {
  if (SECRET_OPS.has(op) && args && 'password' in args) {
    return { ...args, password: '***' };
  }
  return args;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
  op: string;
};

class BLEProtocolError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'BLEProtocolError';
    this.code = code;
    this.details = details;
  }
}

export interface BLEService {
  state: ConnectionState;
  status: DeviceStatus | null;
  protocol: ProtocolMetadata | null;
  isMock: boolean;
  logs: BLELog[];
  setMock: (mock: boolean) => void;
  scanAndConnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  login: (password: string, remember?: boolean) => Promise<void>;
  tryAutoLogin: () => Promise<boolean>;
  getConnectedDeviceKey: () => string | null;
  getSavedPassword: (key: string | null) => string | null;
  savePassword: (key: string | null, password: string, name?: string) => void;
  forgetSavedPassword: (key: string | null) => void;
  getDevicePref: <T>(key: string | null, name: string, fallback: T) => T;
  setDevicePref: (key: string | null, name: string, value: unknown) => void;
  getState: () => Promise<DeviceStatus>;
  getCapabilities: () => Promise<ProtocolMetadata | null>;
  refreshDeviceInfo: () => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  getProfile: (profile: number) => Promise<ProfileData>;
  applyProfile: (profile: number) => Promise<void>;
  saveProfile: (profile: number, brightness: number, contrast: number, enhancement: number) => Promise<void>;
  setBrightness: (value: number) => Promise<void>;
  setContrast: (value: number) => Promise<void>;
  setEnhancement: (value: number) => Promise<void>;
  setPalette: (value: PaletteIndex) => Promise<void>;
  setZoom: (value: number) => Promise<void>;
  setAutoCalibration: (enabled: boolean) => Promise<void>;
  runManualCalibration: () => Promise<void>;
  runScreenAdjust: () => Promise<void>;
  runDpc: () => Promise<void>;
  saveToCamera: () => Promise<void>;
  setBleName: (name: string) => Promise<void>;
  startOta: () => Promise<void>;
  stopOta: () => Promise<void>;
  onStatusUpdate: (callback: (status: DeviceStatus) => void) => () => void;
  onLogsUpdate: (callback: (logs: BLELog[]) => void) => () => void;
  clearLogs: () => void;
  loadLogs: () => Promise<void>;
  isServerLoggingEnabled: () => boolean;
  setServerLoggingEnabled: (enabled: boolean) => void;
  setLocalStatusMessage: (message: string, type?: 'info' | 'error') => void;
}

class ThermalBLEService implements BLEService {
  state: ConnectionState = 'disconnected';
  status: DeviceStatus | null = { ...DEFAULT_STATUS };
  protocol: ProtocolMetadata | null = null;
  isMock = false;
  logs: BLELog[] = [];

  private callbacks: ((status: DeviceStatus) => void)[] = [];
  private logCallbacks: ((logs: BLELog[]) => void)[] = [];
  private device: any = null;
  private server: any = null;
  private protocolChar: any = null;
  private rpcChar: any = null;
  private stateChar: any = null;
  private logChar: any = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private writeChain: Promise<void> = Promise.resolve();
  private requestCounter = 0;
  private lastStateSeq = -1;
  private connectedDeviceKey: string | null = null;
  // Device key that was explicitly logged out — auto-login stays suppressed only
  // for THAT camera (so logging out of one doesn't block auto-login on another).
  private suppressedKey: string | null = null;
  private rpcBuffer = '';
  private stateBuffer = '';
  private logBuffer = '';

  private mockStatus: DeviceStatus = {
    bleName: DEVICE_NAME,
    model: 'TC-V1 (Mock)',
    firmware: '2.0.0-mock',
    modelAgeMs: 0,
    firmwareAgeMs: 0,
    authenticated: false,
    authStatus: 'required',
    activeProfile: 0,
    otaActive: false,
    otaRemainingMs: 0,
    brightness: 120,
    contrast: 3,
    enhancement: 3,
    palette: 0,
    lastResponse: '',
    lastErrorCode: '',
    lastErrorMessage: ''
  };

  private mockProtocol: ProtocolMetadata = {
    v: PROTOCOL_VERSION,
    deviceName: DEVICE_NAME,
    serviceUuid: SERVICE_UUID,
    rpcUuid: RPC_CHAR_UUID,
    stateUuid: STATE_CHAR_UUID,
    logUuid: LOG_CHAR_UUID,
    operations: [
      'auth.login',
      'device.getCapabilities',
      'device.setPassword',
      'device.refreshIdentity',
      'profile.get',
      'profile.apply',
      'profile.save',
      'image.setBrightness',
      'image.setContrast',
      'image.setEnhancement',
      'image.setPalette',
      'image.setZoom',
      'calibration.manual',
      'calibration.screenAdjust',
      'calibration.setAuto',
      'calibration.dpc',
      'calibration.saveToCamera',
      'device.setBleName',
      'ota.start',
      'ota.stop'
    ]
  };

  private addLog(type: BLELog['type'], message: string) {
    const log: BLELog = { type, message, timestamp: Date.now() };
    this.logs = [log, ...this.logs].slice(0, 150);
    this.logCallbacks.forEach(cb => cb(this.logs));
    this.mirrorLogToServer(log);
  }

  isServerLoggingEnabled() {
    return localStorage.getItem(SERVER_LOGGING_KEY) !== 'false';
  }

  setServerLoggingEnabled(enabled: boolean) {
    localStorage.setItem(SERVER_LOGGING_KEY, enabled ? 'true' : 'false');
    this.addLog('info', `Webserver log mirroring ${enabled ? 'enabled' : 'disabled'}`);
  }

  private mirrorLogToServer(log: BLELog) {
    if (!this.isServerLoggingEnabled()) {
      return;
    }

    void fetch(SERVER_LOG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...log,
        state: this.state,
      }),
      keepalive: true,
    }).catch(() => {
      // Best-effort only; local UI logging stays primary.
    });
  }

  async loadLogs() {
    try {
      const response = await fetch(SERVER_LOG_ENDPOINT, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      const body = await response.text();
      if (!body.trim()) {
        return;
      }

      const loadedLogs = body
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            const parsed = JSON.parse(line) as {
              ts?: number;
              type?: BLELog['type'];
              message?: string;
            };

            return {
              timestamp: parsed.ts ?? Date.now(),
              type: parsed.type ?? 'info',
              message: parsed.message ?? '',
            } satisfies BLELog;
          } catch {
            return null;
          }
        })
        .filter((log): log is BLELog => log !== null)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 150);

      if (!loadedLogs.length) {
        return;
      }

      const existing = new Set(this.logs.map((log) => `${log.timestamp}:${log.type}:${log.message}`));
      const merged = [...this.logs];

      for (const log of loadedLogs) {
        const key = `${log.timestamp}:${log.type}:${log.message}`;
        if (!existing.has(key)) {
          merged.push(log);
          existing.add(key);
        }
      }

      merged.sort((a, b) => b.timestamp - a.timestamp);
      this.logs = merged.slice(0, 150);
      this.logCallbacks.forEach(cb => cb(this.logs));
    } catch {
      // Ignore log history load failures; live logging still works.
    }
  }

  clearLogs() {
    this.logs = [];
    this.logCallbacks.forEach(cb => cb(this.logs));
    void fetch(SERVER_LOG_ENDPOINT, { method: 'DELETE', keepalive: true }).catch(() => {
      // Ignore local sink errors.
    });
  }

  setLocalStatusMessage(message: string, type: 'info' | 'error' = 'info') {
    this.addLog(type, message);
    this.status = {
      ...(this.status || DEFAULT_STATUS),
      lastResponse: type === 'info' ? message : this.status?.lastResponse || '',
      lastErrorCode: type === 'error' ? 'local_error' : '',
      lastErrorMessage: type === 'error' ? message : ''
    };
    this.notifyStatus();
  }

  private setState(state: ConnectionState) {
    this.state = state;
    if (!this.status) {
      this.status = { ...DEFAULT_STATUS };
    }
    this.notifyStatus();
  }

  private notifyStatus() {
    if (!this.status) return;
    this.callbacks.forEach(cb => cb({ ...this.status! }));
  }

  private applyState(nextState: DeviceStatus) {
    // Merge onto the PREVIOUS status, not DEFAULT_STATUS: a partial state frame
    // from firmware must not silently reset authenticated/otaActive/etc.
    const base = this.status ?? DEFAULT_STATUS;
    this.status = { ...base, ...nextState };
    this.notifyStatus();
  }

  private nextRequestId() {
    this.requestCounter += 1;
    return `r-${Date.now()}-${this.requestCounter}`;
  }

  private rejectPendingRequests(reason: Error) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(reason);
      this.pendingRequests.delete(id);
    }
  }

  private getStoredDeviceName(): string {
    return localStorage.getItem('ble_device_name') || DEVICE_NAME;
  }

  private setStoredDeviceName(name: string) {
    localStorage.setItem('ble_device_name', name);
  }

  // ---- Per-device credential + preference storage (localStorage) ----

  getConnectedDeviceKey(): string | null {
    if (this.connectedDeviceKey) return this.connectedDeviceKey;
    const name = this.status?.bleName;
    return name ? `name:${name}` : null;
  }

  private readSavedPasswords(): Record<string, SavedPasswordEntry> {
    try {
      return JSON.parse(localStorage.getItem(SAVED_PASSWORDS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  getSavedPassword(key: string | null): string | null {
    if (!key) return null;
    return this.readSavedPasswords()[key]?.password ?? null;
  }

  savePassword(key: string | null, password: string, name?: string) {
    if (!key) return;
    const all = this.readSavedPasswords();
    all[key] = { password, name };
    localStorage.setItem(SAVED_PASSWORDS_KEY, JSON.stringify(all));
  }

  forgetSavedPassword(key: string | null) {
    if (!key) return;
    const all = this.readSavedPasswords();
    if (all[key]) {
      delete all[key];
      localStorage.setItem(SAVED_PASSWORDS_KEY, JSON.stringify(all));
    }
  }

  private readDevicePrefs(): Record<string, Record<string, unknown>> {
    try {
      return JSON.parse(localStorage.getItem(DEVICE_PREFS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  getDevicePref<T>(key: string | null, name: string, fallback: T): T {
    if (!key) return fallback;
    const value = this.readDevicePrefs()[key]?.[name];
    return value === undefined ? fallback : (value as T);
  }

  setDevicePref(key: string | null, name: string, value: unknown) {
    if (!key) return;
    const all = this.readDevicePrefs();
    all[key] = { ...(all[key] || {}), [name]: value };
    localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(all));
  }

  async tryAutoLogin(): Promise<boolean> {
    if (this.status?.authenticated) return false;
    const key = this.getConnectedDeviceKey();
    if (this.suppressedKey && this.suppressedKey === key) return false; // just logged out of this one
    const saved = this.getSavedPassword(key);
    if (!saved) return false;
    try {
      await this.login(saved, true);
      return true;
    } catch {
      // Stored password no longer works (e.g. changed on the device) — forget it,
      // but only for a stable per-device id key (a name fallback may be shared).
      if (key && key.startsWith('id:')) this.forgetSavedPassword(key);
      return false;
    }
  }

  private readText(value: DataView | null | undefined) {
    if (!value) return '';
    return new TextDecoder('utf-8').decode(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }

  private async validateSignalStrength(device: any) {
    const watchAdvertisements = (device as {
      watchAdvertisements?: () => Promise<void>;
    }).watchAdvertisements;

    if (!watchAdvertisements) {
      this.addLog('info', 'RSSI filter unavailable in this browser; continuing without signal-strength check');
      return;
    }

    const rssi = await new Promise<number | null>((resolve) => {
      let settled = false;
      let timeoutId = 0;

      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        device.removeEventListener('advertisementreceived', handleAdvertisement as EventListener);
        resolve(value);
      };

      const handleAdvertisement = (event: Event) => {
        const advertisement = event as Event & { rssi?: number };
        if (typeof advertisement.rssi === 'number') {
          finish(advertisement.rssi);
        }
      };

      timeoutId = window.setTimeout(() => finish(null), 1500);
      device.addEventListener('advertisementreceived', handleAdvertisement as EventListener);

      void watchAdvertisements.call(device).catch(() => finish(null));
    });

    if (rssi === null) {
      this.addLog('info', 'BLE RSSI could not be measured; continuing without signal-strength filter');
      return;
    }

    this.addLog('info', `Detected BLE RSSI ${rssi} dBm`);
    if (rssi < MIN_ACCEPTABLE_RSSI) {
      throw new BLEProtocolError(
        'signal_too_weak',
        `Selected device signal is too weak (${rssi} dBm). Move closer and try again.`
      );
    }
  }

  private async readCurrentState() {
    if (!this.stateChar) {
      return;
    }

    const value = await this.stateChar.readValue();
    const text = this.readText(value);
    if (!text) {
      return;
    }

    this.handleStateEvent(text);
  }

  private async readProtocolMetadata() {
    if (!this.protocolChar) {
      throw new BLEProtocolError('protocol_unavailable', 'Protocol characteristic is not available');
    }

    const value = await this.protocolChar.readValue();
    const text = this.readText(value);
    this.addLog('receive', text);
    const parsed = JSON.parse(text) as ProtocolMetadata;
    if (parsed.v !== PROTOCOL_VERSION) {
      throw new BLEProtocolError('protocol_mismatch', `Expected protocol v${PROTOCOL_VERSION}, got v${parsed.v}`);
    }
    this.protocol = parsed;
    this.setStoredDeviceName(parsed.deviceName || DEVICE_NAME);
  }

  private handleIncomingRpc(text: string) {
    this.appendJsonChunk('rpc', text, (completeText) => {
      this.addLog('receive', completeText);

      let payload: RpcEnvelope;
      try {
        payload = JSON.parse(completeText) as RpcEnvelope;
      } catch {
        this.addLog('error', `Unparseable RPC payload: ${completeText}`);
        return;
      }

      if (payload.type === 'response') {
        const pending = this.pendingRequests.get(payload.id);
        if (!pending) {
          this.addLog('info', `Ignoring response for unknown request ${payload.id}`);
          return;
        }

        window.clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(payload.id);

        if (payload.ok) {
          pending.resolve(payload.result ?? null);
        } else {
          const failure = payload as Extract<RpcEnvelope, { type: 'response'; ok: false }>;
          const error = new BLEProtocolError(failure.code, failure.message, failure.details);
          this.status = {
            ...(this.status || DEFAULT_STATUS),
            lastErrorCode: failure.code,
            lastErrorMessage: failure.message
          };
          this.notifyStatus();
          pending.reject(error);
        }
        return;
      }

      if (payload.type === 'event' && payload.event === 'error') {
        this.status = {
          ...(this.status || DEFAULT_STATUS),
          lastErrorCode: payload.code,
          lastErrorMessage: payload.message
        };
        this.notifyStatus();
        return;
      }

      if (payload.type === 'event' && payload.event === 'log') {
        this.addLog('info', payload.message);
      }
    });
  }

  private handleStateEvent(text: string) {
    this.appendJsonChunk('state', text, (completeText) => {
      this.addLog('receive', completeText);

      let payload: RpcEnvelope;
      try {
        payload = JSON.parse(completeText) as RpcEnvelope;
      } catch {
        this.addLog('error', `Unparseable state payload: ${completeText}`);
        return;
      }

      if (payload.type === 'event' && payload.event === 'state') {
        if (payload.seq <= this.lastStateSeq) return;
        this.lastStateSeq = payload.seq;
        if (payload.state.bleName) {
          this.setStoredDeviceName(payload.state.bleName);
        }
        this.applyState(payload.state);
      }
    });
  }

  private isJsonComplete(candidate: string) {
    let depth = 0;
    let inString = false;
    let escaping = false;
    let started = false;

    for (let i = 0; i < candidate.length; i += 1) {
      const ch = candidate[i];

      if (!started) {
        if (/\s/.test(ch)) {
          continue;
        }
        if (ch !== '{' && ch !== '[') {
          return false;
        }
        started = true;
      }

      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (ch === '\\') {
          escaping = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{' || ch === '[') {
        depth += 1;
        continue;
      }

      if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth < 0) {
          return false;
        }
      }
    }

    return started && !inString && depth === 0;
  }

  private appendJsonChunk(kind: 'rpc' | 'state' | 'log', chunk: string, onComplete: (json: string) => void) {
    const current = kind === 'rpc'
      ? this.rpcBuffer + chunk
      : kind === 'state'
        ? this.stateBuffer + chunk
        : this.logBuffer + chunk;

    if (!this.isJsonComplete(current)) {
      if (kind === 'rpc') this.rpcBuffer = current;
      if (kind === 'state') this.stateBuffer = current;
      if (kind === 'log') this.logBuffer = current;
      return;
    }

    try {
      JSON.parse(current);
      if (kind === 'rpc') this.rpcBuffer = '';
      if (kind === 'state') this.stateBuffer = '';
      if (kind === 'log') this.logBuffer = '';
      onComplete(current);
      return;
    } catch {
      this.addLog('error', `Invalid ${kind} chunk payload: ${current}`);
      if (kind === 'rpc') this.rpcBuffer = '';
      if (kind === 'state') this.stateBuffer = '';
      if (kind === 'log') this.logBuffer = '';
    }
  }

  setMock(mock: boolean) {
    this.isMock = mock;
    this.addLog('info', `Switched to ${mock ? 'Mock' : 'Real'} Mode`);
    if (mock) {
      this.protocol = this.mockProtocol;
      this.applyState({ ...this.mockStatus });
      this.setState('connected');
    } else {
      this.protocol = null;
      this.status = { ...DEFAULT_STATUS };
      this.setState('disconnected');
    }
  }

  async scanAndConnect() {
    if (this.isMock) {
      this.protocol = this.mockProtocol;
      this.connectedDeviceKey = null; // mock uses the name-based fallback key
      this.applyState({ ...this.mockStatus, authenticated: false, authStatus: 'required' });
      this.setState('connected');
      await this.tryAutoLogin().catch(() => {});
      return;
    }

    try {
      this.setState('scanning');
      this.addLog('info', 'Starting scan...');

      const nav = navigator as any;
      if (!nav.bluetooth) {
        throw new BLEProtocolError('bluetooth_unavailable', 'Web Bluetooth is not available in this browser');
      }

      this.device = await nav.bluetooth.requestDevice({
        filters: [
          { services: [SERVICE_UUID] },
        ],
        optionalServices: [SERVICE_UUID]
      });

      this.addLog('info', `Found device: ${this.device.name || DEVICE_NAME}`);
      // device.id is Web Bluetooth's stable per-origin identifier (MAC is hidden).
      this.connectedDeviceKey = this.device?.id ? `id:${this.device.id}` : null;
      await this.validateSignalStrength(this.device);
      this.setState('connecting');

      this.device.addEventListener('gattserverdisconnected', this.handleDisconnected);
      this.server = await this.device.gatt!.connect();

      const service = await this.server.getPrimaryService(SERVICE_UUID);
      this.protocolChar = await service.getCharacteristic(PROTOCOL_CHAR_UUID);
      this.rpcChar = await service.getCharacteristic(RPC_CHAR_UUID);
      this.stateChar = await service.getCharacteristic(STATE_CHAR_UUID);

      try {
        this.logChar = await service.getCharacteristic(LOG_CHAR_UUID);
      } catch {
        this.logChar = null;
      }

      await this.readProtocolMetadata();

      await this.rpcChar.startNotifications();
      this.rpcChar.addEventListener('characteristicvaluechanged', this.onRpcChanged);

      await this.stateChar.startNotifications();
      this.stateChar.addEventListener('characteristicvaluechanged', this.onStateChanged);

      if (this.logChar) {
        try {
          await this.logChar.startNotifications();
          this.logChar.addEventListener('characteristicvaluechanged', this.onLogChanged);
        } catch {
          this.addLog('info', 'Debug log characteristic is unavailable');
        }
      }

      this.lastStateSeq = -1;
      this.status = { ...DEFAULT_STATUS, authStatus: 'required' };
      await this.readCurrentState();
      this.setState('connected');
      // Auto-login runs AFTER a settle delay and OFF the connect path. Writing to
      // the ESP32-C3 the instant the GATT link comes up frequently trips a GATT
      // error / disconnect, so we let the link stabilize and never block or
      // destabilize the connection on auto-login.
      window.setTimeout(() => { void this.tryAutoLogin().catch(() => {}); }, 800);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addLog('error', `Connection failed: ${message}`);
      this.status = {
        ...(this.status || DEFAULT_STATUS),
        lastErrorCode: error instanceof BLEProtocolError ? error.code : 'connection_failed',
        lastErrorMessage: message
      };
      this.setState('error');
      throw error;
    }
  }

  private handleDisconnected = () => {
    this.addLog('error', 'Device disconnected');
    this.rejectPendingRequests(new BLEProtocolError('disconnected', 'Device disconnected'));
    this.protocol = null;
    this.protocolChar = null;
    this.rpcChar = null;
    this.stateChar = null;
    this.logChar = null;
    this.server = null;
    this.device = null;
    this.status = {
      ...DEFAULT_STATUS,
      lastErrorCode: 'disconnected',
      lastErrorMessage: 'Device disconnected'
    };
    this.setState('disconnected');
  };

  async disconnect() {
    // Explicit logout: suppress auto-login for THIS camera only, until manual login.
    this.suppressedKey = this.getConnectedDeviceKey();
    // Keep mock mode consistent (so a mock logout actually shows the lock screen).
    this.mockStatus.authenticated = false;
    this.mockStatus.authStatus = 'required';
    this.rejectPendingRequests(new BLEProtocolError('disconnected', 'Disconnected by user'));
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
      if (this.device.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    }
    // Fully release handles so a later reconnect doesn't reuse stale ones.
    this.protocol = null;
    this.protocolChar = null;
    this.rpcChar = null;
    this.stateChar = null;
    this.logChar = null;
    this.server = null;
    this.device = null;
    this.connectedDeviceKey = null;
    this.status = {
      ...DEFAULT_STATUS,
      lastErrorCode: '',
      lastErrorMessage: ''
    };
    this.setState('disconnected');
  }

  private onRpcChanged = (event: Event) => {
    const target = event.target as any;
    this.handleIncomingRpc(this.readText(target.value));
  };

  private onStateChanged = (event: Event) => {
    const target = event.target as any;
    this.handleStateEvent(this.readText(target.value));
  };

  private onLogChanged = (event: Event) => {
    const target = event.target as any;
    const text = this.readText(target.value);
    this.appendJsonChunk('log', text, (completeText) => {
      this.addLog('info', completeText);
    });
  };

  async request<TResult = any>(op: string, args: Record<string, unknown> = {}, timeoutMs = 2500): Promise<TResult> {
    if (this.isMock) {
      return this.mockRequest<TResult>(op, args);
    }

    if (!this.rpcChar || !this.device?.gatt?.connected) {
      throw new BLEProtocolError('not_connected', 'Not connected');
    }

    const id = this.nextRequestId();
    const payload = JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'request',
      id,
      op,
      args
    });

    this.addLog('send', JSON.stringify({ v: PROTOCOL_VERSION, type: 'request', id, op, args: redactArgs(op, args) }));

    const encoder = new TextEncoder();
    const bytes = encoder.encode(payload);

    return new Promise<TResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new BLEProtocolError('request_timeout', `${op} timed out`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeoutId, op });

      this.writeChain = this.writeChain
        .then(async () => {
          if (this.rpcChar?.writeValueWithResponse) {
            await this.rpcChar.writeValueWithResponse(bytes);
          } else {
            await this.rpcChar!.writeValue(bytes);
          }
        })
        .catch(error => {
          const pending = this.pendingRequests.get(id);
          if (pending) {
            window.clearTimeout(pending.timeoutId);
            this.pendingRequests.delete(id);
            pending.reject(error);
          }
        });
    });
  }

  async login(password: string, remember = false) {
    const result = await this.request<{
      authenticated?: boolean;
      identityRefreshed?: boolean;
      warning?: string;
    }>('auth.login', { password });

    // An `ok` response that reports authenticated:false is a failure, not success.
    if (result?.authenticated === false) {
      this.status = {
        ...(this.status || DEFAULT_STATUS),
        authenticated: false,
        authStatus: 'required',
        lastErrorCode: 'auth_unconfirmed',
        lastErrorMessage: 'Authentication was not confirmed by the device.',
      };
      this.notifyStatus();
      throw new BLEProtocolError('auth_unconfirmed', 'Authentication was not confirmed by the device.');
    }

    this.suppressedKey = null;
    if (remember) {
      this.savePassword(this.getConnectedDeviceKey(), password, this.status?.bleName);
    }

    this.status = {
      ...(this.status || DEFAULT_STATUS),
      authenticated: true,
      authStatus: 'confirmed',
      lastResponse: result?.warning || 'Authenticated',
      lastErrorCode: '',
      lastErrorMessage: '',
    };
    this.notifyStatus();

    void this.readCurrentState().catch(() => {
      // State notify/read is best effort; auth already succeeded.
    });

    void this.refreshDeviceInfo().catch(() => {
      // Identity refresh is best effort after login.
    });
  }

  async getState() {
    return { ...(this.status || DEFAULT_STATUS) };
  }

  async getCapabilities() {
    const result = await this.request<{ protocolVersion: number; deviceName: string; operations: string[] }>('device.getCapabilities');
    this.protocol = {
      ...(this.protocol || this.mockProtocol),
      v: result.protocolVersion,
      deviceName: result.deviceName,
      operations: result.operations
    };
    return this.protocol;
  }

  async refreshDeviceInfo() {
    await this.request('device.refreshIdentity', {}, 4000);
    await this.readCurrentState();
  }

  async setPassword(password: string) {
    await this.request('device.setPassword', { password }, 4000);
    // The saved password for this camera is now stale — drop it so auto-login
    // doesn't keep trying the old one.
    this.forgetSavedPassword(this.getConnectedDeviceKey());
    this.status = {
      ...(this.status || DEFAULT_STATUS),
      authenticated: false,
      authStatus: 'required',
      lastResponse: 'BLE password updated. Reconnect with the new password.',
      lastErrorCode: '',
      lastErrorMessage: '',
    };
    this.notifyStatus();
  }

  async getProfile(profile: number) {
    return this.request<ProfileData>('profile.get', { profile });
  }

  async applyProfile(profile: number) {
    await this.request('profile.apply', { profile });
  }

  async saveProfile(profile: number, brightness: number, contrast: number, enhancement: number) {
    await this.request('profile.save', { profile, brightness, contrast, enhancement });
  }

  async setBrightness(value: number) {
    await this.request('image.setBrightness', { value });
  }

  async setContrast(value: number) {
    await this.request('image.setContrast', { value });
  }

  async setEnhancement(value: number) {
    await this.request('image.setEnhancement', { value });
  }

  async setPalette(value: PaletteIndex) {
    await this.request('image.setPalette', { value });
  }

  async setZoom(value: number) {
    await this.request('image.setZoom', { value });
  }

  async setAutoCalibration(enabled: boolean) {
    await this.request('calibration.setAuto', { enabled });
  }

  async runManualCalibration() {
    // Real shutter NUC can take a few seconds — don't use the 2.5s default.
    await this.request('calibration.manual', {}, 6000);
  }

  async runScreenAdjust() {
    await this.request('calibration.screenAdjust', {}, 6000);
  }

  async runDpc() {
    // DPC blocks the device for ~3.2s (calibrate + save), so allow a longer timeout.
    await this.request('calibration.dpc', {}, 8000);
  }

  async saveToCamera() {
    await this.request('calibration.saveToCamera');
  }

  async setBleName(name: string) {
    await this.request('device.setBleName', { name });
  }

  async startOta() {
    try {
      await this.request<{ otaActive?: boolean; otaPending?: boolean; otaRemainingMs?: number }>('ota.start');
    } catch (error) {
      if (!(error instanceof BLEProtocolError) || error.code !== 'request_timeout') {
        throw error;
      }
      this.addLog('info', 'ota.start timed out; keeping optimistic OTA state because the device may already be switching radios');
    }

    this.status = {
      ...(this.status || DEFAULT_STATUS),
      otaActive: true,
      otaRemainingMs: 300000,
      lastResponse: 'OTA window starting',
      lastErrorCode: '',
      lastErrorMessage: '',
    };
    this.notifyStatus();
  }

  async stopOta() {
    try {
      await this.request<{ otaActive?: boolean; otaRemainingMs?: number }>('ota.stop');
    } catch (error) {
      if (!(error instanceof BLEProtocolError) || error.code !== 'request_timeout') {
        throw error;
      }
      this.addLog('info', 'ota.stop timed out; keeping optimistic OTA state because the device may already be switching radios');
    }

    this.status = {
      ...(this.status || DEFAULT_STATUS),
      otaActive: false,
      otaRemainingMs: 0,
      lastResponse: 'OTA window stopping',
      lastErrorCode: '',
      lastErrorMessage: '',
    };
    this.notifyStatus();
  }

  private async mockRequest<TResult>(op: string, args: Record<string, unknown>) {
    this.addLog('send', JSON.stringify({ v: PROTOCOL_VERSION, type: 'request', op, args: redactArgs(op, args) }));
    await new Promise(resolve => setTimeout(resolve, 120));

    if (op === 'auth.login') {
      if (args.password === 'changeme' || args.password === '1234') {
        this.mockStatus = {
          ...this.mockStatus,
          authenticated: true,
          authStatus: 'confirmed',
          lastResponse: 'Authenticated',
          lastErrorCode: '',
          lastErrorMessage: ''
        };
        this.applyState({ ...this.mockStatus });
        return { authenticated: true } as TResult;
      }
      throw new BLEProtocolError('auth_failed', 'Incorrect password');
    }

    if (!this.mockStatus.authenticated) {
      throw new BLEProtocolError('auth_required', 'Authenticate first');
    }

    switch (op) {
      case 'device.getCapabilities':
        return {
          protocolVersion: PROTOCOL_VERSION,
          deviceName: this.mockStatus.bleName || DEVICE_NAME,
          operations: this.mockProtocol.operations
        } as TResult;
      case 'device.refreshIdentity':
        this.mockStatus.model = 'TC-V1 (Mock)';
        this.mockStatus.firmware = '2.0.0-mock';
        this.mockStatus.modelAgeMs = 0;
        this.mockStatus.firmwareAgeMs = 0;
        this.mockStatus.lastResponse = 'Device identity refreshed';
        break;
      case 'device.setPassword':
        this.mockStatus.authenticated = false;
        this.mockStatus.authStatus = 'required';
        this.mockStatus.lastResponse = 'BLE password updated. Reconnect with the new password.';
        break;
      case 'profile.get': {
        const profile = Number(args.profile ?? 0);
        return {
          profile,
          palette: (profile % 5) as PaletteIndex,
          brightness: 100 + profile * 20,
          contrast: profile % 8,
          enhancement: (profile + 2) % 8
        } as TResult;
      }
      case 'profile.apply':
        this.mockStatus.activeProfile = Number(args.profile ?? 0);
        this.mockStatus.lastResponse = 'Profile applied';
        break;
      case 'profile.save':
        this.mockStatus.lastResponse = 'Profile saved';
        break;
      case 'image.setBrightness':
        this.mockStatus.brightness = Number(args.value ?? this.mockStatus.brightness ?? 120);
        this.mockStatus.lastResponse = 'Brightness updated';
        break;
      case 'image.setContrast':
        this.mockStatus.contrast = Number(args.value ?? this.mockStatus.contrast ?? 3);
        this.mockStatus.lastResponse = 'Contrast updated';
        break;
      case 'image.setEnhancement':
        this.mockStatus.enhancement = Number(args.value ?? this.mockStatus.enhancement ?? 3);
        this.mockStatus.lastResponse = 'Enhancement updated';
        break;
      case 'image.setPalette':
        this.mockStatus.palette = Number(args.value ?? this.mockStatus.palette ?? 0) as PaletteIndex;
        this.mockStatus.lastResponse = 'Palette updated';
        break;
      case 'image.setZoom':
        this.mockStatus.lastResponse = 'Zoom updated';
        break;
      case 'calibration.setAuto':
        this.mockStatus.lastResponse = (args.enabled ? 'Auto calibration enabled' : 'Auto calibration disabled');
        break;
      case 'calibration.manual':
        this.mockStatus.lastResponse = 'Manual calibration started';
        break;
      case 'calibration.screenAdjust':
        this.mockStatus.lastResponse = 'Screen adjust started';
        break;
      case 'calibration.dpc':
        this.mockStatus.lastResponse = 'Dead pixel correction complete';
        break;
      case 'calibration.saveToCamera':
        this.mockStatus.lastResponse = 'Settings saved to camera';
        break;
      case 'device.setBleName':
        this.mockStatus.bleName = String(args.name ?? DEVICE_NAME);
        this.mockStatus.lastResponse = 'BLE name updated';
        break;
      case 'ota.start':
        this.mockStatus.otaActive = true;
        this.mockStatus.otaRemainingMs = 300000;
        this.mockStatus.lastResponse = 'OTA window started';
        break;
      case 'ota.stop':
        this.mockStatus.otaActive = false;
        this.mockStatus.otaRemainingMs = 0;
        this.mockStatus.lastResponse = 'OTA window stopped';
        break;
      default:
        throw new BLEProtocolError('unknown_op', `Unknown op: ${op}`);
    }

    this.mockStatus.lastErrorCode = '';
    this.mockStatus.lastErrorMessage = '';
    this.applyState({ ...this.mockStatus });
    return {} as TResult;
  }

  onStatusUpdate(callback: (status: DeviceStatus) => void) {
    this.callbacks.push(callback);
    callback({ ...(this.status || DEFAULT_STATUS) });
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  onLogsUpdate(callback: (logs: BLELog[]) => void) {
    this.logCallbacks.push(callback);
    callback(this.logs);
    return () => {
      this.logCallbacks = this.logCallbacks.filter(cb => cb !== callback);
    };
  }
}

export const bleService = new ThermalBLEService();
