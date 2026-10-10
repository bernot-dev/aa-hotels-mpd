/** True in development builds (webpack --mode development), which include the debug tooling. */
declare const __AA_MPD_DEBUG__: boolean;

/** CommonJS require, for modules that only development builds load (see __AA_MPD_DEBUG__). */
declare function require(id: string): unknown;
