import { test } from "node:test";
import assert from "node:assert/strict";
import { canAdd, draftStatus, MIN_SALARY, ROSTER_SIZE, SALARY_CAP, salaryFor, slotsFor, type DraftPick } from "./draft.ts";

let nextId = 1;
const pick = (position: string, role: DraftPick["role"], salary = 30): DraftPick => ({ playerId: nextId++, position, role, salary });

/** A legal 12-man team: C, 1B, 2B, 3B, SS, 3 OF, DH, 1 SP, 2 RP. */
function legalRoster(salary = 30): DraftPick[] {
  return [
    pick("C", "H", salary), pick("1B", "H", salary), pick("2B", "H", salary), pick("3B", "H", salary),
    pick("SS", "H", salary), pick("LF", "H", salary), pick("CF", "H", salary), pick("RF", "H", salary),
    pick("DH", "H", salary),
    pick("P", "SP", salary), pick("P", "RP", salary), pick("P", "RP", salary),
  ];
}

test("salary grows with rating and has a floor", () => {
  assert.equal(salaryFor(70), 30);
  assert.ok(salaryFor(99) > salaryFor(90) && salaryFor(90) > salaryFor(80));
  assert.equal(salaryFor(40), MIN_SALARY);
  // A team of all-average players fits comfortably under the cap; two superstars don't.
  assert.ok(ROSTER_SIZE * salaryFor(70) < SALARY_CAP);
  assert.ok(2 * salaryFor(99) + (ROSTER_SIZE - 2) * MIN_SALARY > SALARY_CAP);
});

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
  const roster = legalRoster().filter((p) => p.position !== "C");
  const s = draftStatus(roster);
  assert.ok(!s.ready);
  assert.ok(s.problems.some((p) => p.startsWith("Pick 12")));
  assert.ok(s.problems.some((p) => p.startsWith("Catcher")));
});

test("over the cap is not ready", () => {
  const s = draftStatus(legalRoster(60));
  assert.ok(s.payroll > SALARY_CAP);
  assert.ok(s.problems.some((p) => p.startsWith("Over the salary cap")));
});

test("canAdd blocks duplicates, a full roster, and spending the money needed for the rest", () => {
  const roster = legalRoster().slice(0, 5);
  assert.equal(canAdd(roster, pick("SS", "H")), null);
  assert.match(canAdd(roster, roster[0])!, /Already/);
  assert.match(canAdd(legalRoster(), pick("SS", "H"))!, /full/);
  // 5 players at $3M = $15M spent; 6 spots after this pick need $3M, so max affordable is $42M.
  assert.equal(canAdd(roster, pick("SS", "H", 420)), null);
  assert.match(canAdd(roster, pick("SS", "H", 421))!, /fill your other 6 spots/);
});

test("canAdd keeps room for both hitters and pitchers", () => {
  const hitters = legalRoster().slice(0, 9);
  assert.match(canAdd(hitters, pick("SS", "H"))!, /9 hitters/);
  assert.equal(canAdd(hitters, pick("P", "SP")), null);
  const staff = legalRoster().slice(9);
  assert.match(canAdd(staff, pick("P", "RP"))!, /3 pitchers/);
  assert.equal(canAdd(staff, pick("TWP", "TWP")), null);
});
