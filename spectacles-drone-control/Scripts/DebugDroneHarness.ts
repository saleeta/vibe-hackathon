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
      print('[DebugDroneHarness] Ready. Try simulateTakeoff(), simulateFlyToDestination(), simulateEmergency(), or simulateBatteryUpdate().');
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

  simulateBatteryUpdate(batteryPercent: number = 78): void {
    DroneEvents.onStatusReceived.invoke({ type: 'state', batteryPercent });
  }

  simulateBridgeError(message: string = 'no response from drone'): void {
    DroneEvents.onStatusReceived.invoke({ type: 'error', raw: message });
  }
}
