import { DroneEvents } from './Core/DroneEvents';

/**
 * Debug/testing harness — exercises B2-B4's command flow and status display
 * without real hand tracking or a live drone/bridge. Call from the Logger
 * panel. (B1's anchor placement genuinely needs real hand tracking + the
 * Spatial Anchors session, so it isn't simulated here — test that one on
 * hardware.)
 */
@component
export class DebugDroneHarness extends BaseScriptComponent {
  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      print('[DebugDroneHarness] Ready. Try simulateTakeoff(), simulateLand(), simulateFlyLeft/Right/Up/Down(), simulateFlyToDestination(), simulateEmergency(), simulateBatteryUpdate(), or simulateVoiceResponse().');
    });
  }

  simulateTakeoff(): void {
    DroneEvents.onCommandRequested.invoke({ type: 'takeoff' });
  }

  simulateLand(): void {
    DroneEvents.onCommandRequested.invoke({ type: 'land' });
  }

  simulateEmergency(): void {
    DroneEvents.onCommandRequested.invoke({ type: 'emergency' });
  }

  simulateFlyToDestination(x: number = 100, y: number = 0, z: number = -50): void {
    DroneEvents.onCommandRequested.invoke({ type: 'goto', x, y, z, speed: 40 });
  }

  /** Matches DirectionalHandController's defaults (50cm step, 40cm/s) — same go-vector convention: y = left(+)/right(-), z = up(+)/down(-). */
  simulateFlyLeft(distanceCm: number = 50): void {
    DroneEvents.onCommandRequested.invoke({ type: 'goto', x: 0, y: distanceCm, z: 0, speed: 40 });
  }

  simulateFlyRight(distanceCm: number = 50): void {
    DroneEvents.onCommandRequested.invoke({ type: 'goto', x: 0, y: -distanceCm, z: 0, speed: 40 });
  }

  simulateFlyUp(distanceCm: number = 50): void {
    DroneEvents.onCommandRequested.invoke({ type: 'goto', x: 0, y: 0, z: distanceCm, speed: 40 });
  }

  simulateFlyDown(distanceCm: number = 50): void {
    DroneEvents.onCommandRequested.invoke({ type: 'goto', x: 0, y: 0, z: -distanceCm, speed: 40 });
  }

  simulateBatteryUpdate(batteryPercent: number = 78): void {
    DroneEvents.onStatusReceived.invoke({ type: 'state', batteryPercent });
  }

  simulateBridgeError(message: string = 'no response from drone'): void {
    DroneEvents.onStatusReceived.invoke({ type: 'error', raw: message });
  }

  /** Exercises DroneVoiceResponder's TTS without a live bridge or ASR. */
  simulateVoiceResponse(text: string = 'Taking off now.'): void {
    DroneEvents.onStatusReceived.invoke({ type: 'ack', spokenText: text });
  }
}
