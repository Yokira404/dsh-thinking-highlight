/**
 * Host half of @local/dsh-thinking-highlight.
 *
 * The rendering, the keyword engine, and the preferences all live in the Client
 * half (./client.js): they are browser presentation state, stored in the
 * browser, and must keep working while the Host composition is unchanged. This
 * half exists because a bundle row is what makes the package loadable and what
 * publishes `dsh.client` to the client-modules scan that serves the browser
 * bundle.
 *
 * Keep this module to the single `apply` export: Cordis loads a row by applying
 * a plugin, so a module that exports only constants has nothing to apply and the
 * row stays inactive ("failed to import"). Values the Client needs are declared
 * there instead.
 */

export function apply() {}
