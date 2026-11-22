# Roadmap

Plans, not promises. Dates are not set.

## Near term

- Release the iOS and Android apps, which are in development.

## 3D and XR

1. **3D math in the engine:** `z = f(x, y)` surfaces, parametric curves, and 3D points and vectors.
2. **A 3D view with three.js** in the web and phone apps, loaded only when a 3D graph opens so startup stays fast. The phone is the part to prototype first, since a native app has no web page to run it in. three.js is MIT, so it ships inside the app.
3. **VR on Quest through WebXR,** in the headset's browser, with no install.
4. **A renderer-neutral scene format,** so other renderers can draw what the engine produces without containing the calculator.
5. **Native XR, if WebXR falls short.** Godot is the serious choice: its MIT license matches this project and it exports to Quest.
6. **Slopculator Unreal Edition,** because a calculator that needs a AAA engine to draw a parabola is funny. It has to be a separate download: Epic's EULA covers any product containing engine code, so it can't ship inside the MIT app.
