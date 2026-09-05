"""
Phase 1 test: this PC acts as a BLE central (same role Spectacles'
BluetoothCentralModule would play in Phase 2), scans for the ESP32's GATT
peripheral, connects, subscribes to the response characteristic, then
writes a command and prints whatever comes back.

Run: python test_ble_client.py [command]
     (defaults to "battery?" if no command given)
"""

import asyncio
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from bleak import BleakClient, BleakScanner

DEVICE_NAME = "ESP32-Drone-Bridge"
COMMAND_CHAR_UUID = "12345678-1234-5678-1234-56789abc0001"
RESPONSE_CHAR_UUID = "12345678-1234-5678-1234-56789abc0002"


async def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "battery?"

    print(f"Scanning for '{DEVICE_NAME}'...")
    device = await BleakScanner.find_device_by_name(DEVICE_NAME, timeout=10.0)
    if device is None:
        print("ERROR: device not found. Is the ESP32 powered on and advertising?")
        return

    print(f"Found: {device.address}. Connecting...")
    async with BleakClient(device) as client:
        print("Connected.")

        response_received = asyncio.Event()
        latest_response = {"value": None}

        def on_notify(_handle, data: bytearray):
            print(f"  (raw bytes: {data.hex()})")
            latest_response["value"] = data.decode(errors="replace")
            response_received.set()

        await client.start_notify(RESPONSE_CHAR_UUID, on_notify)

        print(f"Sending command: {command!r}")
        await client.write_gatt_char(COMMAND_CHAR_UUID, command.encode())

        try:
            await asyncio.wait_for(response_received.wait(), timeout=15.0)
            print(f"Response: {latest_response['value']!r}")
        except asyncio.TimeoutError:
            print("No response notification received within 15s.")

        await client.stop_notify(RESPONSE_CHAR_UUID)


if __name__ == "__main__":
    asyncio.run(main())
