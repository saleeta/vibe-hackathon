/**
 * Shared types for the drone-control module. Fully standalone — no
 * dependency on spectacles-perception or spectacles-voice-memory, so this
 * can be dropped into a project alone.
 */

export type DroneCommandType = 'takeoff' | 'land' | 'emergency' | 'goto' | 'battery_query';

/** One command sent to the bridge relay, which translates it into Tello's real UDP text protocol. */
export interface DroneCommand {
  type: DroneCommandType;
  /** Relative move in cm, only for type 'goto'. Tello's real range is -500..500 per axis. */
  x?: number;
  y?: number;
  z?: number;
  /** cm/s, only for type 'goto'. Tello's real range is 10..100. */
  speed?: number;
}

/** State/ack messages relayed back from the bridge. */
export interface DroneStatusMessage {
  type: 'ack' | 'error' | 'state';
  /** Raw text the drone replied with ("ok", "error", or a state line), for 'ack'/'error'. */
  raw?: string;
  /** Parsed telemetry, for 'state' (only the fields the bridge chose to forward). */
  batteryPercent?: number;
  heightCm?: number;
}

export type HandSide = 'left' | 'right';
export const HandSide = { Left: 'left' as HandSide, Right: 'right' as HandSide };
