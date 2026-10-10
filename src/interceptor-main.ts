// MAIN world entry (document_start). Kept apart from interceptor.ts so the content script can
// import its parsing helpers without patching fetch and IntersectionObserver in its own world.
import { initNetworkInterceptor } from "./interceptor";

initNetworkInterceptor();
