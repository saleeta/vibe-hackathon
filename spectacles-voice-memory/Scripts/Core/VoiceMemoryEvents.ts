import { ObjectDetection, ObjectSighting, VoiceIntent, LocateObjectResult } from './VoiceMemoryTypes';

/**
 * Minimal typed pub/sub — same pattern as spectacles-perception's Signal,
 * duplicated rather than imported so this module has zero cross-module
 * dependency and can be dropped into a project alone.
 */
class Signal<T> {
  private listeners: Array<(data: T) => void> = [];
  add(callback: (data: T) => void): (data: T) => void {
    this.listeners.push(callback);
    return callback;
  }
  remove(callback: (data: T) => void): void {
    const i = this.listeners.indexOf(callback);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  invoke(data: T): void {
    for (const listener of this.listeners.slice()) listener(data);
  }
}

/**
 * The plug-and-play surface of this module — every B1-B4 script talks to
 * its neighbors only through these signals, same philosophy as
 * PerceptionEvents in spectacles-perception.
 */
class VoiceMemoryEventBus {
  /** B1: feed of raw object-class detections — whatever detector is plugged in reports here. */
  readonly onObjectDetected = new Signal<ObjectDetection>();

  /** B1 output: a tracked object's "last seen" record was finalized (it left view). */
  readonly onSightingRecorded = new Signal<ObjectSighting>();

  /** B3 output: the wearer asked "where are my X" and it parsed to a known object class. */
  readonly onVoiceIntent = new Signal<VoiceIntent>();

  /** Orchestrator output: the lookup result for a voice intent — B4 (UI) and B3 (speech) both listen here. */
  readonly onLocateObjectResult = new Signal<LocateObjectResult>();
}

export const VoiceMemoryEvents = new VoiceMemoryEventBus();
