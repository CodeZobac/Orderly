import { Composition, registerRoot } from "remotion";
import { LogoComposition, defaultPalette } from "./logo-composition";
const Root = () => (
  <Composition
    id="OrderlyLogo"
    component={LogoComposition}
    defaultProps={{ palette: defaultPalette }}
    width={960}
    height={640}
    fps={30}
    durationInFrames={390}
  />
);
registerRoot(Root);
