/**
 * Orientation estimate from gyro + accelerometer (complementary filter).
 * Pitch and roll are drift-free thanks to gravity; yaw is integrated gyro and can be recentred.
 * All outputs are in degrees.
 */
import type { ControllerState } from './state';

const RAD = 180 / Math.PI;

export class MotionTracker {
  pitch = 0;
  roll = 0;
  yaw = 0;
  private offPitch = 0;
  private offRoll = 0;
  private lastUs: number | null = null;
  private lastMs: number | null = null;
  /** weight of the gyro path, 0..1 */
  alpha = 0.98;

  update(s: ControllerState, nowMs: number) {
    if (!s.hasMotion) return;
    let dt: number;
    if (s.timestampUs != null && this.lastUs != null) {
      let d = s.timestampUs - this.lastUs;
      if (d < 0) d += 2 ** 32 / 3; // 32-bit counter wrap (1/3 µs ticks)
      dt = d / 1e6;
    } else if (this.lastMs != null) {
      dt = (nowMs - this.lastMs) / 1000;
    } else {
      dt = 0;
    }
    this.lastUs = s.timestampUs;
    this.lastMs = nowMs;
    if (!(dt > 0 && dt < 0.25)) dt = 0;

    const { x: ax, y: ay, z: az } = s.accel;
    // Gravity-based tilt. At rest, flat on a table, gravity points along +Y.
    const accPitch = Math.atan2(az, Math.hypot(ax, ay)) * RAD;
    const accRoll = Math.atan2(-ax, ay) * RAD;
    const accOk = Math.abs(Math.hypot(ax, ay, az) - 1) < 0.35;

    const gp = this.pitch + this.offPitch + s.gyro.x * dt;
    const gr = this.roll + this.offRoll - s.gyro.z * dt;
    const pitchAbs = accOk ? this.alpha * gp + (1 - this.alpha) * accPitch : gp;
    const rollAbs = accOk ? this.alpha * gr + (1 - this.alpha) * accRoll : gr;
    this.pitch = pitchAbs - this.offPitch;
    this.roll = rollAbs - this.offRoll;
    this.yaw = wrap180(this.yaw + s.gyro.y * dt);
  }

  /** Makes the current pose the new zero for all three axes. */
  recenter() {
    this.offPitch += this.pitch;
    this.offRoll += this.roll;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
  }
}

function wrap180(a: number) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}
