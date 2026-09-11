export const POSE_PARTS = Object.freeze({ neutral: 'PoseNeutral', lean: 'PoseLean', point: 'PosePoint' });
export const ACTING_PARAMETERS = Object.freeze(['ParamBreath', 'ParamEyeROpen', 'ParamMouthOpenY']);

// The painted poses are key poses. Keep them mutually exclusive to avoid ghost arms.
export class Acting {
  constructor() { this.reset(); }
  reset() { this.pose = 'neutral'; this.phase = 'idle'; this.elapsed = 0; }
  select(pose) {
    if (!Object.hasOwn(POSE_PARTS, pose)) throw new Error('Unknown pose: ' + pose);
    this.pose = pose; this.phase = 'idle'; this.elapsed = 0;
  }
  begin() {
    if (this.phase === 'enter' || this.phase === 'hold') return;
    this.pose = 'lean'; this.phase = 'enter'; this.elapsed = 0;
  }
  end() {
    if (this.phase === 'idle' && this.pose === 'neutral') return;
    this.pose = 'lean'; this.phase = 'exit'; this.elapsed = 0;
  }
  update(dt) {
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.phase === 'enter' && this.elapsed >= .14) { this.pose = 'point'; this.phase = 'hold'; this.elapsed = 0; }
    if (this.phase === 'exit' && this.elapsed >= .12) this.reset();
    return Object.fromEntries(Object.entries(POSE_PARTS).map(([pose, id]) => [id, Number(pose === this.pose)]));
  }
}
