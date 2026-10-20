# Previous generated Orderly 13 and clock

The live sidebar now uses the supplied `public/logo-13-chessclock-transparent.png` asset. The model and Remotion composition below remain available as standalone authoring assets.

The extruded amber **13** and graphite clock are two separate mesh groups with visible space between them. The clock contains hour indices, centered hands, a crown and a moving seconds indicator; no numerals are merged into its dial.

The previous sidebar implementation loaded a Remotion Player. `remotion/logo-composition.tsx` controls the gentle numeral tilt and indicator motion by frame, so playback and Studio seeking agree. The loop lasts 13 seconds while tracking and 26 seconds while idle. Motion pauses offscreen, on hidden pages and for reduced-motion preferences. The decorative mark never supplies tracked time. An SVG fallback is available while loading and in print.

- `npm run logo:studio`: edit/preview the `OrderlyLogo` composition in Remotion Studio.
- `npm run logo:export`: regenerate `orderly-13.glb`, a standalone glTF 2.0 model with a seconds-indicator animation, from `lib/logo-model.ts` and the existing theme tokens.
- `orderly-13-preview.png`: rendered close-up and sidebar-size preview.

The Studio palette provides standalone defaults; the previous sidebar resolved named CSS theme tokens to sRGB. No movie is exported as part of the app build.
