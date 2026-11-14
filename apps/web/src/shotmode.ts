/** `?shot=...` art-review mode is dev-only: a production bundle ignores the parameter (`dev` is `import.meta.env.DEV`). */
export function shotModeActive(dev: boolean, search: string): boolean {
  return dev && new URLSearchParams(search).has("shot");
}
