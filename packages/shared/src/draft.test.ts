import { test } from "node:test";
import assert from "node:assert/strict";
import { canAdd, draftStatus, slotsFor, type DraftPick } from "./draft.ts";

let nextId = 1;
const pick = (position: string, role: DraftPick["role"]): DraftPick => ({ playerId: nextId++, position, role });

/** A legal 12-man team: C, 1B, 2B, 3B, SS, 3 OF, DH, 1 SP, 2 RP. */
function legalRoster(): DraftPick[] {
  return [
    pick("C", "H"), pick("1B", "H"), pick("2B", "H"), pick("3B", "H"), pick("SS", "H"),
    pick("LF", "H"), pick("CF", "H"), pick("RF", "H"), pick("DH", "H"),
    pick("P", "SP"), pick("P", "RP"), pick("P", "RP"),
  ];
}

test("slots: outfield spots merge, two-way players count twice", () => {
  assert.deepEqual(slotsFor({ position: "CF", role: "H" }), ["OF"]);
  assert.deepEqual(slotsFor({ position: "P", role: "RP" }), ["RP"]);
  assert.deepEqual(slotsFor({ position: "TWP", role: "TWP" }), ["DH", "SP"]);
});

test("a legal roster is ready", () => {
  const s = draftStatus(legalRoster());
  assert.equal(s.size, 12);
  assert.deepEqual(s.problems, []);
  assert.ok(s.ready);
});

test("missing positions and too few players are listed", () => {
  const s = draftStatus(legalRoster().filter((p) => p.position !== "C"));
  assert.ok(!s.ready);
  assert.ok(s.problems.some((p) => p.startsWith("Pick 12")));
  assert.ok(s.problems.some((p) => p.startsWith("Catcher")));
});

test("canAdd blocks duplicates and a full roster", () => {
  const roster = legalRoster().slice(0, 5);
  assert.equal(canAdd(roster, pick("SS", "H")), null);
  assert.match(canAdd(roster, roster[0])!, /Already/);
  assert.match(canAdd(legalRoster(), pick("SS", "H"))!, /full/);
});

test("canAdd keeps room for both hitters and pitchers", () => {
  const hitters = legalRoster().slice(0, 9);
  assert.match(canAdd(hitters, pick("SS", "H"))!, /9 hitters/);
  assert.equal(canAdd(hitters, pick("P", "SP")), null);
  const staff = legalRoster().slice(9);
  assert.match(canAdd(staff, pick("P", "RP"))!, /3 pitchers/);
  assert.equal(canAdd(staff, pick("TWP", "TWP")), null);
});

test("two starters and a reliever is a legal staff", () => {
  const roster = [...legalRoster().slice(0, 9), pick("P", "SP"), pick("P", "SP"), pick("P", "RP")];
  assert.ok(draftStatus(roster).ready, draftStatus(roster).problems.join(" "));
});
