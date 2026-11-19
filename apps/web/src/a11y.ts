// Screen-reader names for the gameplay controls (W39). Presentation only: these strings feed aria-label and nothing else.
const BASE_WORD = { first: "first base", second: "second base", third: "third base", home: "home plate" } as const;
export const baseTargetLabel = (b: keyof typeof BASE_WORD, recommended: boolean) => `Throw to ${BASE_WORD[b]}${recommended ? ", recommended" : ""}`;
export const speedLabel = (x: number) => `Game speed ${x}x`;
export const abilityChipLabel = (name: string, cost: number, state: string, armed: boolean) => `${name}, costs ${cost} Heat, ${state.toLowerCase()}${armed ? ", tap to cancel" : ""}`;
export const swingLabel = (kind: "contact" | "power" | "super") => kind === "super" ? "Super swing" : `${kind === "power" ? "Power" : "Contact"} swing`;
export const gloveLabel = (verb: string) => `${verb[0]}${verb.slice(1).toLowerCase()} the ball`;
