# Automatic fill integrations

The popup's **Fill** button calls `globalThis.__charlesEngine.run(request)` for
each deliberate fill. Integrations that watch ATS form changes should instead
call `globalThis.__charlesEngine.runAutomatic(request)` after injecting
`dist/content/engine.js` and waiting for the application form to be ready.

```js
const summary = await globalThis.__charlesEngine.runAutomatic(request)
```

`runAutomatic` starts at most one fill attempt per document/frame. Overlapping
calls and later form-change notifications return the first attempt's promise;
they cannot restart filling and overwrite manual corrections. The guard also
survives reinjecting the engine bundle. It applies equally to Greenhouse and
Workday. A full page load creates a fresh guard; SPA navigation does not.

The first request wins, even if later calls supply a different request. Failed
attempts remain cached to prevent mutation-driven retry loops. Calling before
the form is ready also consumes the attempt, so the caller must wait for
readiness. For another application step, a corrected request, or a retry, use
an explicit `run(request)` call. Explicit fills do not reset the automatic guard.

An integration should disconnect its mutation observer after the initial
attempt and handle rejected promises. This API provides a second guard if
notifications are already queued or another caller reinjects the bundle.
Charles itself does not install an automatic mutation observer; integrations
must opt into this entrypoint rather than repeatedly calling `run`.

Run `npm test`, `npm run typecheck`, and `npm run build` from this directory to
validate changes to the engine entrypoint.
