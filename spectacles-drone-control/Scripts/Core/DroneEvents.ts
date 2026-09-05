import { DroneCommand, DroneStatusMessage } from './DroneTypes';

/** Minimal typed pub/sub — same duplicated pattern as the other two modules, kept standalone on purpose. */
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

class DroneEventBus {
  /** B2 output: a gesture resolved to a drone command — B3's bridge client sends it. */
  readonly onCommandRequested = new Signal<DroneCommand>();

  /** B3 output: a status/ack/telemetry message came back from the bridge. */
  readonly onStatusReceived = new Signal<DroneStatusMessage>();

  /** B1 output: home or destination anchor was (re)placed — fires with which one and its world position. */
  readonly onAnchorPlaced = new Signal<{ role: 'home' | 'destination'; worldPosition: vec3 }>();
}

export const DroneEvents = new DroneEventBus();
