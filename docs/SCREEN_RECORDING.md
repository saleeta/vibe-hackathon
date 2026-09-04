# Screen recording: overlaying the Lens HUD on the camera view

Requirement: when the wearer records, what they see (the AR nutrition HUD)
should be captured composited on top of what the camera sees (the real
world), not as two separate streams.

## This is mostly free on Spectacles — if the Lens is built correctly

Spectacles' own hardware capture (single press = photo/short Snap, hold =
video, per
[Capturing photos and videos](https://support.spectacles.com/hc/en-us/articles/360033756691-Capturing-photos-and-videos))
records the composited AR view: real-world passthrough plus whatever the
active Lens renders. That composite is controlled in Lens Studio by the
Scene's **Live Target / Capture Target / Overlay Target** settings on the
Camera object
([Camera overview docs](https://developers.snap.com/lens-studio/lens-studio-workflow/scene-set-up/camera)):

- **Live Target** — what the wearer sees live.
- **Capture Target** — what actually gets written into the recorded video/photo.
- **Overlay Target** — content composited on top (e.g. a HUD layer).

So the "make sure recording overlays the camera" requirement is satisfied by
construction, on the condition that **the nutrition HUD (session status,
detected food, running kcal) is rendered on a layer that is included in the
Capture Target**, not on a layer explicitly excluded from capture. Lens
Studio does support excluding a layer from what gets recorded (used e.g. for
debug-only overlays) — our HUD must deliberately avoid that exclusion.

### Action item for whoever builds the Scene in Lens Studio

1. Put all Person-B-facing UI (session banner, detected food list, running
   kcal/macros, confidence indicator) on the Camera's default screen-space
   layer that feeds the Capture Target.
2. Do not mark that layer/canvas as "hide in capture" or route it only to the
   Live/Overlay Target if that target is excluded from the recorded output.
3. Sanity check: use Lens Studio's Preview panel record button (bottom of the
   Preview panel — records the Lens's simulated output including UI) before
   testing on hardware, then confirm on-device with an actual hardware
   recording that the HUD shows up in the saved video.

## Things that are NOT solved automatically

- **Programmatic start/stop of a hardware recording from script** is not a
  capability we found documented for Spectacles as of this writing — hardware
  recording is user-initiated via the physical button. If the product needs
  an in-Lens "start recording my meal" affordance beyond the physical button,
  that needs to be re-checked against the current Spectacles API docs
  (`developers.snap.com/spectacles`) before assuming it's possible; don't
  build against an assumed API here.
- **In-Lens Preview-panel recordings** (for iterating without hardware) are a
  separate, developer-only path and aren't what the wearer's device produces
  — useful for our own QA of the HUD-in-capture requirement above, not a
  substitute for on-device verification.

## Sources consulted

- [Capturing photos and videos – Spectacles Support](https://support.spectacles.com/hc/en-us/articles/360033756691-Capturing-photos-and-videos)
- [Camera overview | Snap for Developers](https://developers.snap.com/lens-studio/lens-studio-workflow/scene-set-up/camera)
- [Previewing Your Lens | Snap for Developers](https://developers.snap.com/lens-studio/lens-studio-workflow/previewing-your-lens)
