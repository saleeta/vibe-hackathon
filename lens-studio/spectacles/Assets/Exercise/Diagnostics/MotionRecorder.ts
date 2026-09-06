import { PerceptionEvents } from '../../Core/PerceptionEvents';
import { HandsSnapshot, HandState } from '../../Core/PerceptionTypes';
import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
import { LogLevel } from 'SpectaclesInteractionKit.lspkg/Utils/LogLevel';

/**
 * Curl-focused data-collection harness. Runs a timed sequence of held poses
 * and curl reps on a Text prompt, and every `sampleIntervalMs` records the
 * candidate curl-detection channels so we can see which one gives the
 * cleanest, most FOV-tolerant arc:
 *
 *   tipYrel  - index-tip Y minus head Y            (current BicepCurlTracker signal, position)
 *   palmYrel - palm-centre Y minus head Y          (position)
 *   pitchDeg - SIK getPalmPitchAngle()             (orientation)
 *   fwdY     - wrist "forward" unit-vector Y        (orientation, ~forearm direction)
 *   upY      - wrist "up" unit-vector Y             (orientation)
 *   face     - SIK isFacingCamera()                 (pose sanity)
 *   trk      - isTracked                            (dropout rate near the shoulder)
 *
 * Rows are buffered and dumped in one burst at the end (bracketed by
 * DUMP BEGIN / DUMP END) plus a per-phase SUMMARY, because the device log
 * buffer is small. SIK Info logging is dropped to Warning on startup so the
 * hand-tracking spam doesn't roll the dump away. Every line is `[FitData]`.
 *
 * Disable the real trackers while capturing. Save the LS project (Ctrl+S)
 * before Send-to-Spectacles or the new build isn't sent.
 */
@component
export class MotionRecorder extends BaseScriptComponent {
  @input
  @hint('The camera SceneObject (head-height reference).')
  camera: SceneObject;

  @input
  @hint('Big on-screen instruction text. Line 1 = what to do, line 2 = countdown.')
  promptText: Text;

  @input
  @hint('Milliseconds between logged CSV rows. 60 = ~16 Hz.')
  sampleIntervalMs: number = 60;

  @input
  @hint('If no pinch happens, auto-start the sequence this many ms after awake. 0 = wait for pinch only.')
  autoStartMs: number = 6000;

  @input
  @hint('Seconds for the held-pose / rest phases.')
  holdSeconds: number = 6;

  @input
  @hint('Seconds for a SLOW curl set (aim ~5 full reps).')
  slowSetSeconds: number = 22;

  @input
  @hint('Seconds for the FAST curl set (aim ~8 reps).')
  fastSetSeconds: number = 14;

  @input
  @hint('Also dump every raw CSV row at the end. Off = per-phase SUMMARY only.')
  dumpRawRows: boolean = true;

  private gestureModule: GestureModule = require('LensStudio:GestureModule');
  private latestHands: HandsSnapshot | null = null;

  private phases: Array<{ name: string; label: string; durMs: number }> = [];
  private awakeAtMs = 0;
  private sessionStartMs = 0;
  private started = false;
  private finished = false;
  private phaseIndex = -1;
  private lastSampleMs = 0;

  private rows: string[] = [];
  private agg: Record<string, PhaseAgg> = {};

  onAwake(): void {
    if (!this.camera) {
      print('[FitData] ERROR - `camera` input not set. Aborting.');
      return;
    }
    this.awakeAtMs = getTime() * 1000;

    try {
      SIK.SIKLogLevelProvider.logLevel = LogLevel.Warning;
      print('[FitData] SIK log level -> Warning (silenced hand-tracking spam for capture).');
    } catch (err) {
      print(`[FitData] could not lower SIK log level: ${err}`);
    }

    const hold = this.holdSeconds * 1000;
    this.phases = [
      { name: 'armdown', label: 'RIGHT ARM STRAIGHT DOWN - hold still', durMs: hold },
      { name: 'armcurl', label: 'RIGHT ARM CURLED to shoulder - hold still', durMs: hold },
      { name: 'slowR', label: 'RIGHT curls - SLOW & full, count 5', durMs: this.slowSetSeconds * 1000 },
      { name: 'fastR', label: 'RIGHT curls - FAST, count 8', durMs: this.fastSetSeconds * 1000 },
      { name: 'rest', label: 'both arms down, relax', durMs: hold },
      { name: 'slowL', label: 'LEFT curls - SLOW & full, count 5', durMs: this.slowSetSeconds * 1000 },
      { name: 'done', label: 'STAND STILL (finishing)', durMs: hold },
    ];

    PerceptionEvents.onHandsUpdated.add((s) => (this.latestHands = s));
    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Left).add(() => this.startSession());
    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Right).add(() => this.startSession());
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());

    this.setPrompt('Get ready', this.autoStartMs > 0 ? `pinch or wait ${Math.round(this.autoStartMs / 1000)}s` : 'pinch to start');
    print('[FitData] MotionRecorder (curl) armed. Sequence: ' + this.phases.map((p) => `${p.name}(${Math.round(p.durMs / 1000)}s)`).join(' -> '));
  }

  private startSession(): void {
    if (this.started) return;
    this.started = true;
    this.sessionStartMs = getTime() * 1000;
    this.phaseIndex = -1;
    print(`[FitData] >>> SESSION START at ${this.sessionStartMs.toFixed(0)}ms`);
  }

  private onUpdate(): void {
    if (!this.camera || this.finished) return;
    const nowMs = getTime() * 1000;

    if (!this.started) {
      if (this.autoStartMs > 0 && nowMs >= this.awakeAtMs + this.autoStartMs) this.startSession();
      return;
    }

    const elapsed = nowMs - this.sessionStartMs;
    let acc = 0;
    let idx = 0;
    for (; idx < this.phases.length; idx++) {
      acc += this.phases[idx].durMs;
      if (elapsed < acc) break;
    }
    if (idx >= this.phases.length) {
      this.finish(elapsed);
      return;
    }
    if (idx !== this.phaseIndex) {
      this.phaseIndex = idx;
      print(`[FitData] >>> phase=${this.phases[idx].name} atMs=${elapsed.toFixed(0)} durMs=${this.phases[idx].durMs}`);
    }
    this.setPrompt(this.phases[idx].label, `${Math.ceil((acc - elapsed) / 1000)}s`);

    if (nowMs - this.lastSampleMs < this.sampleIntervalMs) return;
    this.lastSampleMs = nowMs;
    this.sample(this.phases[idx].name, elapsed);
  }

  private sample(phaseName: string, elapsed: number): void {
    const headY = this.camera.getTransform().getWorldPosition().y;
    const h = this.latestHands;
    const a = this.aggFor(phaseName);
    a.n++;

    const chan = (r: HandState | null, tag: string): string => {
      if (!r || !r.isTracked) return '0,,,,,';
      const tipY = r.indexTipPosition.y - headY;
      const palmY = r.palmPosition.y - headY;
      const pitch = typeof r.palmPitchDeg === 'number' ? r.palmPitchDeg : NaN;
      const fwdY = r.wristForward ? r.wristForward.y : NaN;
      const upY = r.wristUp ? r.wristUp.y : NaN;
      const face = r.isFacingCamera ? 1 : 0;
      if (tag === 'R') a.rTrk++;
      else a.lTrk++;
      a.push(`${tag}_tip`, tipY);
      a.push(`${tag}_palm`, palmY);
      a.push(`${tag}_pitch`, pitch);
      a.push(`${tag}_fwdY`, fwdY);
      a.push(`${tag}_upY`, upY);
      return `1,${tipY.toFixed(2)},${palmY.toFixed(2)},${isNaN(pitch) ? '' : pitch.toFixed(2)},${isNaN(fwdY) ? '' : fwdY.toFixed(4)},${isNaN(upY) ? '' : upY.toFixed(4)},${face}`;
    };

    if (this.dumpRawRows) {
      this.rows.push(
        `${elapsed.toFixed(0)},${phaseName},${getDeltaTime().toFixed(4)},${headY.toFixed(2)},` +
          `${chan(h ? h.right : null, 'R')},${chan(h ? h.left : null, 'L')}`
      );
    } else {
      // still need the agg side effects
      chan(h ? h.right : null, 'R');
      chan(h ? h.left : null, 'L');
    }
  }

  private finish(elapsed: number): void {
    this.finished = true;
    this.setPrompt('DONE', `${this.rows.length} rows - tell Claude now`);
    print(`[FitData] <<< SESSION COMPLETE rows=${this.rows.length} durMs=${elapsed.toFixed(0)}`);

    print('[FitData] SUMMARY phase,n,Rtrk,Ltrk | per hand: tip[min..max sp] pitch[..] fwdY[..] upY[..] palm[..]');
    for (const p of this.phases) {
      const a = this.agg[p.name];
      if (!a || a.n === 0) {
        print(`[FitData] SUMMARY ${p.name},0`);
        continue;
      }
      print(`[FitData] SUMMARY ${p.name},${a.n},${a.rTrk},${a.lTrk} | R ${a.fmt('R_tip')} ${a.fmt('R_pitch')} ${a.fmt('R_fwdY')} ${a.fmt('R_upY')} ${a.fmt('R_palm')} | L ${a.fmt('L_tip')} ${a.fmt('L_pitch')} ${a.fmt('L_fwdY')} ${a.fmt('L_upY')} ${a.fmt('L_palm')}`);
    }

    if (this.dumpRawRows) {
      print('[FitData] DUMP BEGIN header=ms,phase,dt,cWY,Rtrk,RtipYrel,RpalmYrel,RpitchDeg,RfwdY,RupY,Rface,Ltrk,LtipYrel,LpalmYrel,LpitchDeg,LfwdY,LupY,Lface');
      for (let i = 0; i < this.rows.length; i++) print(`[FitData] R${i} ${this.rows[i]}`);
      print(`[FitData] DUMP END count=${this.rows.length}`);
    }
  }

  private aggFor(name: string): PhaseAgg {
    if (!this.agg[name]) this.agg[name] = new PhaseAgg();
    return this.agg[name];
  }

  private setPrompt(line1: string, line2: string): void {
    if (this.promptText) this.promptText.text = `${line1}\n${line2}`;
  }
}

class PhaseAgg {
  n = 0;
  rTrk = 0;
  lTrk = 0;
  private mn: Record<string, number> = {};
  private mx: Record<string, number> = {};
  private cnt: Record<string, number> = {};

  push(key: string, val: number): void {
    if (val !== val) return; // NaN
    if (this.cnt[key] === undefined) {
      this.mn[key] = val;
      this.mx[key] = val;
      this.cnt[key] = 0;
    }
    if (val < this.mn[key]) this.mn[key] = val;
    if (val > this.mx[key]) this.mx[key] = val;
    this.cnt[key]++;
  }

  fmt(key: string): string {
    if (this.cnt[key] === undefined) return `${key}=na`;
    const lo = this.mn[key];
    const hi = this.mx[key];
    return `${key}=${lo.toFixed(2)}..${hi.toFixed(2)} sp${(hi - lo).toFixed(2)}`;
  }
}
