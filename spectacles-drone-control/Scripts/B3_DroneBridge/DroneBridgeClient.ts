import { DroneEvents } from '../Core/DroneEvents';
import { DroneCommand, DroneStatusMessage } from '../Core/DroneTypes';

// Built-in module via require() — no @input asset wiring needed.
const nativeInternetModule: InternetModule = require('LensStudio:InternetModule');

/**
 * B3 — talks to the drone-bridge relay over WebSocket. The bridge — not
 * this file — owns Tello's actual UDP text protocol; this just ships JSON.
 *
 * TODO(verify): Lens Studio's docs say wss:// is required "on most
 * platforms" — plain ws:// may be rejected on real hardware even though it
 * can work in editor preview. See drone-bridge/README.md for the TLS setup
 * needed if so.
 */
@component
export class DroneBridgeClient extends BaseScriptComponent {
  @input
  @hint('URL of the local bridge relay, e.g. wss://192.168.10.2:8765')
  bridgeUrl: string = 'wss://192.168.10.2:8765';

  private socket: WebSocket | null = null;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.connect());
    DroneEvents.onCommandRequested.add((cmd) => this.send(cmd));
  }

  private connect(): void {
    try {
      this.socket = nativeInternetModule.createWebSocket(this.bridgeUrl);
      this.socket.onopen = () => print('[DroneBridgeClient] Connected to bridge.');
      // No DOM lib in Lens Studio's TS environment — MessageEvent/CloseEvent
      // aren't ambient types here (compiler-verified: TS2304), so these
      // callback payloads are read as structurally-typed objects instead.
      this.socket.onmessage = (event: any) => this.handleMessage(event);
      this.socket.onerror = () => print('[DroneBridgeClient] WebSocket error.');
      this.socket.onclose = (event: any) => print(`[DroneBridgeClient] Closed (clean=${event.wasClean}).`);
    } catch (err) {
      print(`[DroneBridgeClient] Failed to connect (expected in some editor-preview states, or if the bridge isn't running): ${err}`);
    }
  }

  private handleMessage(event: any): void {
    if (typeof event.data !== 'string') return; // the bridge only ever sends JSON text frames
    try {
      const message = JSON.parse(event.data) as DroneStatusMessage;
      DroneEvents.onStatusReceived.invoke(message);
    } catch (err) {
      print(`[DroneBridgeClient] Failed to parse bridge message: ${err}`);
    }
  }

  private send(command: DroneCommand): void {
    if (!this.socket) {
      print('[DroneBridgeClient] Not connected — dropping command.');
      return;
    }
    this.socket.send(JSON.stringify(command));
  }
}
