// MAIN world entry (document_start). Kept apart from interceptor.ts so the content script can
// import its parsing helpers without patching fetch and IntersectionObserver in its own world.
import { initNetworkInterceptor } from "./interceptor";

// Development builds only; production builds drop this branch and the module with it
if (__AA_MPD_DEBUG__) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a conditional require lets webpack drop the module
  (require("./debug-recorder") as typeof import("./debug-recorder")).installNetworkRecorder();
}

initNetworkInterceptor();
