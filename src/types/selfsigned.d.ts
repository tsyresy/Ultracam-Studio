/* Minimal stub typings for `selfsigned` (MIT) — the package ships no types. */
declare module 'selfsigned' {
  export interface SelfSignedAttrs {
    name: string;
    value: string;
  }
  export interface SelfSignedOptions {
    keySize?: number;
    days?: number;
    algorithm?: string;
    extensions?: unknown[];
    [key: string]: unknown;
  }
  export interface SelfSignedResult {
    private: string;
    public: string;
    cert: string;
    fingerprint: string;
  }
  export function generate(
    attrs?: SelfSignedAttrs[],
    options?: SelfSignedOptions
  ): SelfSignedResult;
  const _default: { generate: typeof generate };
  export default _default;
}
