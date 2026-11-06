/** WebHID driver for the DualSense: connection management, input events, output reports. */
import {
  DEFAULT_CALIBRATION,
  DUALSENSE_PRODUCT_IDS,
  SONY_VENDOR_ID,
  buildBtOutputReport,
  buildUsbOutputReport,
  parseCalibration,
  parseInputReport,
  type Calibration,
  type OutputState,
  type Transport,
} from './dualsense-report';
import type { ControllerState } from './state';

const FILTERS: HIDDeviceFilter[] = DUALSENSE_PRODUCT_IDS.map((productId) => ({
  vendorId: SONY_VENDOR_ID,
  productId,
}));

export interface HidEvents {
  onState(state: ControllerState): void;
  onConnection(connected: boolean, info?: { name: string; transport: Transport }): void;
}

export class DualSenseHID {
  private device: HIDDevice | null = null;
  private calib: Calibration = DEFAULT_CALIBRATION;
  private outSeq = 0;
  private lightbarInitDone = false;
  private pendingOutput: OutputState | null = null;
  private sending = false;
  transport: Transport = 'usb';

  constructor(private events: HidEvents) {}

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  get connected() {
    return !!this.device?.opened;
  }

  /** Reconnect to a previously permitted controller (no user gesture needed) and watch for hot-plug. */
  async init() {
    if (!DualSenseHID.supported) return;
    navigator.hid.addEventListener('connect', (e) => {
      if (!this.device && isDualSense(e.device)) void this.open(e.device);
    });
    navigator.hid.addEventListener('disconnect', (e) => {
      if (e.device === this.device) this.close();
    });
    const devices = await navigator.hid.getDevices();
    const ds = devices.find(isDualSense);
    if (ds) await this.open(ds);
  }

  /** Shows the browser's device picker. Must be called from a user gesture. */
  async request(): Promise<boolean> {
    if (!DualSenseHID.supported) return false;
    const devices = await navigator.hid.requestDevice({ filters: FILTERS });
    if (!devices.length) return false;
    await this.open(devices[0]);
    return true;
  }

  private async open(device: HIDDevice) {
    try {
      if (!device.opened) await device.open();
    } catch (err) {
      console.warn('[drumtroller] could not open DualSense', err);
      return;
    }
    this.device = device;
    this.transport = detectTransport(device);
    this.lightbarInitDone = false;
    device.addEventListener('inputreport', this.onInputReport);

    // Reading the calibration feature report also switches Bluetooth controllers into the
    // extended 0x31 report mode with motion + touch data.
    try {
      const view = await device.receiveFeatureReport(0x05);
      this.calib = parseCalibration(view);
    } catch (err) {
      console.warn('[drumtroller] calibration report unavailable, using defaults', err);
      this.calib = DEFAULT_CALIBRATION;
    }
    this.events.onConnection(true, { name: device.productName || 'DualSense', transport: this.transport });
  }

  private close() {
    this.device?.removeEventListener('inputreport', this.onInputReport);
    this.device = null;
    this.events.onConnection(false);
  }

  private onInputReport = (e: HIDInputReportEvent) => {
    if (e.reportId === 0x31) this.transport = 'bt';
    const state = parseInputReport(e.reportId, e.data, this.calib);
    if (state) this.events.onState(state);
  };

  /** Queues an output state; only the latest pending state is sent. */
  setOutput(state: OutputState) {
    this.pendingOutput = state;
    if (!this.sending) void this.flush();
  }

  private async flush() {
    this.sending = true;
    try {
      while (this.pendingOutput && this.device?.opened) {
        const st = this.pendingOutput;
        this.pendingOutput = null;
        const opts = { initLightbar: !this.lightbarInitDone };
        const rep =
          this.transport === 'bt'
            ? buildBtOutputReport(st, this.outSeq++ & 0x0f, opts)
            : buildUsbOutputReport(st, opts);
        await this.device.sendReport(rep.reportId, rep.data);
        if (opts.initLightbar) {
          this.lightbarInitDone = true;
          // The light-out setup only takes effect on its own; resend the colour afterwards.
          if (!this.pendingOutput) this.pendingOutput = st;
        }
      }
    } catch (err) {
      console.warn('[drumtroller] output report failed', err);
    } finally {
      this.sending = false;
    }
  }
}

function isDualSense(d: HIDDevice) {
  return d.vendorId === SONY_VENDOR_ID && DUALSENSE_PRODUCT_IDS.includes(d.productId);
}

function detectTransport(d: HIDDevice): Transport {
  for (const c of d.collections ?? []) {
    for (const r of c.outputReports ?? []) {
      if (r.reportId === 0x31) return 'bt';
    }
  }
  return 'usb';
}
