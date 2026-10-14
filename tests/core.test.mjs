// node tests/core.test.mjs
import assert from "node:assert/strict";
import * as c from "../src/shared/core.js";

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

// days and resets
assert.equal(c.dayKey(at(2026, 10, 14, 0, 30)), "2026-10-14");
assert.equal(c.dayKey(at(2026, 10, 14, 1, 30), 4), "2026-10-13", "before the reset hour counts as yesterday");
assert.equal(c.dayKey(at(2026, 10, 14, 4, 0), 4), "2026-10-14");
assert.equal(c.nextReset(at(2026, 10, 14, 15)), at(2026, 10, 15, 0));
assert.equal(c.nextReset(at(2026, 10, 14, 2), 4), at(2026, 10, 14, 4));
assert.equal(c.nextReset(at(2026, 10, 14, 4), 4), at(2026, 10, 15, 4));

// hosts and domains
assert.equal(c.hostOf("https://www.YouTube.com/watch?v=1"), "youtube.com");
assert.equal(c.hostOf("chrome://extensions"), null);
assert.equal(c.cleanDomain(" https://www.Reddit.com/r/x "), "reddit.com");
assert.equal(c.cleanDomain("m.youtube.com"), "m.youtube.com");
assert.equal(c.cleanDomain("not a site"), null);
assert.equal(c.cleanDomain("localhost"), null);
assert.ok(c.hostMatches("m.youtube.com", "youtube.com"));
assert.ok(!c.hostMatches("notyoutube.com", "youtube.com"));

// usage and status
const rule = { id: "a", name: "Social", domains: ["reddit.com", "x.com"], limit: 30 };
const usage = { "reddit.com": 900, "old.reddit.com": 300, "x.com": 600, "youtube.com": 5000 };
assert.equal(c.ruleSeconds(rule, usage), 1800);
const now = at(2026, 10, 14, 15);
let st = c.ruleStatus(rule, usage, {}, now, 0);
assert.ok(st.over && st.locked && st.left === 0);
st = c.ruleStatus(rule, usage, { a: now + 60000 }, now, 0);
assert.ok(st.over && !st.locked && st.unlocked);
st = c.ruleStatus(rule, usage, { a: now - 1 }, now, 0);
assert.ok(st.locked, "an expired unlock locks again");
st = c.ruleStatus({ ...rule, limit: 0 }, {}, {}, now, 0);
assert.ok(st.locked, "0 minutes blocks immediately");

// tightening vs loosening
const old = { resetHour: 0, rules: [rule] };
assert.ok(c.isTightening(old, { resetHour: 0, rules: [{ ...rule, limit: 20 }] }));
assert.ok(c.isTightening(old, { resetHour: 0, rules: [rule, { id: "b", domains: ["tiktok.com"], limit: 5 }] }));
assert.ok(c.isTightening(old, { resetHour: 0, rules: [{ ...rule, domains: [...rule.domains, "instagram.com"] }] }));
assert.ok(!c.isTightening(old, { resetHour: 0, rules: [{ ...rule, limit: 31 }] }));
assert.ok(!c.isTightening(old, { resetHour: 0, rules: [] }));
assert.ok(!c.isTightening(old, { resetHour: 0, rules: [{ ...rule, domains: ["reddit.com"] }] }));
assert.ok(!c.isTightening(old, { resetHour: 4, rules: [rule] }));

// validation
assert.deepEqual(c.validateRule({ domains: ["Reddit.com", "reddit.com"], limit: 10 }).rule.domains, ["reddit.com"]);
assert.equal(c.validateRule({ domains: ["reddit.com", "nope"], limit: 10 }).error, "TL-501");
assert.equal(c.validateRule({ domains: [], limit: 10 }).error, "TL-501");
assert.equal(c.validateRule({ domains: ["a.com"], limit: -1 }).error, "TL-502");
assert.equal(c.validateRule({ domains: ["a.com"], limit: 2.5 }).error, "TL-502");
assert.equal(c.validateRule({ domains: ["a.com"], limit: NaN }).error, "TL-502");

assert.equal(c.validateRule({ domains: ["a.com"], limit: 5 }).rule.clock, false, "clock is opt-in");
assert.equal(c.validateRule({ domains: ["a.com"], limit: 5, clock: true }).rule.clock, true);

// misc
assert.equal(c.fmtDuration(42), "42s");
assert.equal(c.fmtDuration(125 * 60), "2h 05m");
assert.ok(c.newer("1.0.10", "1.0.9") && !c.newer("1.0.0", "1.0"));
assert.equal(c.cooldownMs(2), 0);
assert.equal(c.cooldownMs(3), 30000);
assert.equal(c.cooldownMs(20), 600000);

console.log("All core tests passed.");
