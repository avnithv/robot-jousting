// Forward kinematics for the arena, mirrored from tools/make_dashboard_data.py (which mirrors sim/arena.py).
// The chain is the SO101 MJCF (body pos/quat + hinge joints about local z); the sword rides on the moving jaw.
// Joint vectors are [pan, lift, elbow, wrist_flex, wrist_roll, jaw] in SIM degrees (real wrist_roll - 76).
// Positions are metres in the arm's own frame: pan axis at x = 0, x forward, y to the arm's left, z up from the base plane.

export const JOINTS = ['pan', 'lift', 'elbow', 'wrist_flex', 'wrist_roll', 'jaw'];
export const JOINT_LABELS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
export const ROLL_OFFSET = 76;
export const BASE_GAP = 0.61, CENTRE_X = 0.305, HAND_X_MAX = 0.27, SERVO_CAP = 300, LIFT_MIN = -89;
export const WRIST_FLOORS = { wrist_flex: 0.120, wrist_roll: 0.092 };
export const BEAT = 1.4, IMPACT = 1.0, GUARD = 0.55;
export const PAN_AXIS_Z = 0.0624;
const HILT_REACH = 0.353, SWORD_LEN = 0.18, PAN_AXIS_X = 0.0388353;

const CHAIN = [
  ['shoulder',  [0.0388353, 0, 0.0624],            [0, 0, -1, 0]],
  ['upper_arm', [-0.0303992, -0.0182778, -0.0542], [0.5, -0.5, -0.5, -0.5]],
  ['lower_arm', [-0.11257, -0.028, 0],             [0.707107, 0, 0, 0.707107]],
  ['wrist',     [-0.1349, 0.0052, 0],              [0.707107, 0, 0, -0.707107]],
  ['gripper',   [0, -0.0611, 0.0181],              [0.0172091, -0.0172091, 0.706897, 0.706897]],
  ['jaw',       [0.0202, 0.0188, -0.0234],         [0.707107, 0.707107, 0, 0]],
];

const rad = d => d * Math.PI / 180;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = a => Math.hypot(a[0], a[1], a[2]);

function quatToMat(q) {
  const n = Math.hypot(...q); const [w, x, y, z] = q.map(v => v / n);
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
function mul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}
function mv(A, v) { return [dot(A[0], v), dot(A[1], v), dot(A[2], v)]; }
function mtv(A, v) { return [A[0][0] * v[0] + A[1][0] * v[1] + A[2][0] * v[2], A[0][1] * v[0] + A[1][1] * v[1] + A[2][1] * v[2], A[0][2] * v[0] + A[1][2] * v[1] + A[2][2] * v[2]]; }
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const STATIC = CHAIN.map(([, p, q]) => ({ p, R: quatToMat(q) }));

function fkBodies(qSim) {
  let p = [0, 0, 0], R = I3; const out = [];
  for (let i = 0; i < 6; i++) {
    p = add(p, mv(R, STATIC[i].p)); R = mul(mul(R, STATIC[i].R), rotZ(rad(qSim[i] || 0))); out.push({ p, R });
  }
  return out;
}

// sword + fixed-jaw tip, set up once at the zero pose exactly as arena._arm_with_sword does
const B0 = fkBodies([0, 0, 0, 0, 0, 0]);
const g0 = B0[4], j0 = B0[5];
const hilt0 = [PAN_AXIS_X + HILT_REACH, g0.p[1], g0.p[2]];
const d0 = sub(hilt0, j0.p); const dist0 = norm(d0); const dir0 = scale(d0, 1 / dist0);
const SWORD_DIR_LOCAL = mtv(j0.R, dir0);
const SWORD_START_LOCAL = scale(SWORD_DIR_LOCAL, dist0);
const FIXED_TIP_LOCAL = mtv(g0.R, sub(hilt0, g0.p));
const SHIFT = [PAN_AXIS_X, 0, 0];

/** Pose of one arm in its own frame. anchors: pan, lift, elbow, wrist_flex, wrist_roll (gripper origin), jaw pivot. */
export function fk(qSim) {
  const B = fkBodies(qSim);
  const jaw = B[5], grip = B[4];
  const hilt = sub(add(jaw.p, mv(jaw.R, SWORD_START_LOCAL)), SHIFT);
  const dir = mv(jaw.R, SWORD_DIR_LOCAL);
  const tip = add(hilt, scale(dir, SWORD_LEN));
  const fixedTip = sub(add(grip.p, mv(grip.R, FIXED_TIP_LOCAL)), SHIFT);
  const anchors = B.map(b => sub(b.p, SHIFT));
  const pitch = Math.atan2(dir[2], Math.hypot(dir[0], dir[1])) * 180 / Math.PI;
  const handR = Math.hypot(hilt[0], hilt[1]) * Math.sign(hilt[0] || 1);
  return { anchors, fixedTip, hilt, tip, dir, pitch, handR };
}

/** Own frame -> arena world. A at x=0 facing +x; B at x=BASE_GAP facing -x (its left is world -y). */
export function toWorld(p, arm) { return arm === 'B' ? [BASE_GAP - p[0], -p[1], p[2]] : p; }
export function poseWorld(qSim, arm) {
  const f = fk(qSim); const w = p => toWorld(p, arm);
  return { anchors: f.anchors.map(w), fixedTip: w(f.fixedTip), hilt: w(f.hilt), tip: w(f.tip), pitch: f.pitch, handR: f.handR, own: f };
}

/** Closest distance between segments p1-p2 and q1-q2 (Ericson 5.1.9). */
export function segDist(p1, p2, q1, q2) { return segClosest(p1, p2, q1, q2).d; }
/** Same, returning the closest points as well: { d, p, q }. */
export function segClosest(p1, p2, q1, q2) {
  const d1 = sub(p2, p1), d2 = sub(q2, q1), r = sub(p1, q1);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), eps = 1e-12; let s, t;
  const clamp = v => Math.min(1, Math.max(0, v));
  if (a <= eps && e <= eps) return { d: norm(r), p: p1, q: q1 };
  if (a <= eps) { s = 0; t = clamp(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= eps) { t = 0; s = clamp(-c / a); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > eps ? clamp((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  const p = add(p1, scale(d1, s)), q = add(q1, scale(d2, t));
  return { d: norm(sub(p, q)), p, q };
}

/** Real-degree joint vector of a move at time t (clamped, linear between 50 Hz samples). */
export function sampleQ(move, t) {
  const T = move.t, Q = move.q, n = T.length;
  if (t <= T[0]) return Q[0].slice();
  if (t >= T[n - 1]) return Q[n - 1].slice();
  let i = Math.min(n - 2, Math.max(0, Math.floor(t / (T[n - 1] / (n - 1)))));
  while (i > 0 && T[i] > t) i--; while (i < n - 2 && T[i + 1] < t) i++;
  const u = (t - T[i]) / (T[i + 1] - T[i]);
  return Q[i].map((v, k) => v + (Q[i + 1][k] - v) * u);
}
export function sampleAt(arr, T, t) {   // same, for any per-frame array (numbers or vectors)
  const n = T.length; if (t <= T[0]) return arr[0]; if (t >= T[n - 1]) return arr[n - 1];
  let i = Math.min(n - 2, Math.max(0, Math.floor(t / (T[n - 1] / (n - 1)))));
  while (i > 0 && T[i] > t) i--; while (i < n - 2 && T[i + 1] < t) i++;
  const u = (t - T[i]) / (T[i + 1] - T[i]); const a = arr[i], b = arr[i + 1];
  return Array.isArray(a) ? a.map((v, k) => v + (b[k] - v) * u) : a + (b - a) * u;
}
export const toSim = q => { const s = q.slice(); s[4] -= ROLL_OFFSET; return s; };

/** Beat alignment for a pair (chain.py rule): attacks/feints pin their last key at IMPACT, blocks their guard key at
 *  GUARD. Moves are front-padded; when a key is later than its pin the whole beat stretches (both arms). */
export function alignPair(a, b) {
  const padA = a.pin ? a.pin.pad : 0, padB = b.pin ? b.pin.pad : 0;
  const m = Math.min(padA, padB, 0);
  const offA = padA - m, offB = padB - m, stretch = -m;
  const duration = Math.max(offA + a.duration, offB + b.duration, BEAT + stretch);
  return { offA, offB, stretch, impactT: IMPACT + stretch, guardT: GUARD + stretch, duration };
}
