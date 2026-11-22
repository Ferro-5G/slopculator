# Roadmap

Plans, not promises. No dates are set.

## Near term

- Ship the iOS and Android apps (currently in development).

## 3D and XR

1. **3D math in the engine.** Surfaces (`z = f(x, y)`), parametric curves, and 3D points and vectors.
2. **3D graph view with three.js.** Loaded on demand so startup stays fast. Prototype on mobile first, since native apps don't have a browser viewport.
3. **Quest VR via WebXR.** Runs in the headset browser with no install.
4. **Renderer-neutral scene format.** Lets external renderers draw engine output without embedding the calculator.
5. **Native XR fallback.** If WebXR falls short, Godot is the main option since its MIT license matches this repo and it exports to Quest.
6. **Slopculator Unreal Edition.** A calculator that needs a AAA engine to draw a parabola is funny. It has to be a separate download because Epic's EULA can't ship inside an MIT repo.
