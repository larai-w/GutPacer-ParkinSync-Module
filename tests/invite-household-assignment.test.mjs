// 招待ごとの世帯割り当て（issue #4）。AWS は呼ばない。
//
// **守りたいのは1つだけ。** 招待された2世帯目が、1世帯目の記録を見られないこと。
// いままでは招待を満たすと全員が既定世帯に入っていたので、
// 2世帯目を招いた瞬間に別の家の排便・服薬の記録が見えていた。
//
// ここで固定する不変条件:
//   1. 招待コードごとに違う世帯へ入る
//   2. 事前に世帯を割り当てた人は、その世帯へ入る
//   3. **割り当ての無い招待は通さない**（既定世帯へ落とさない）
//   4. 旧来の招待（INVITED_USER_IDS / INVITE_CODE_HASH）は既定世帯のまま壊れない
//   5. 設定が壊れていても、起動を止めない（空として扱い、fail closed になる）

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
    isValidHouseholdId,
    parseInviteAssignments,
    resolveInvitedHousehold,
} from "../backend/invite-assignments.mjs";

const DEFAULT_HOUSEHOLD = "household:gutpacer-default";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function assignmentsFor(codes = {}, users = {}) {
    return parseInviteAssignments(JSON.stringify({ codes, users }));
}

test("招待コードごとに違う世帯へ入る", () => {
    const assignments = assignmentsFor({
        [sha256("code-a")]: "household:aaa",
        [sha256("code-b")]: "household:bbb",
    });

    const a = resolveInvitedHousehold({
        userId: "U-first", inviteCode: "code-a", assignments,
        fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });
    const b = resolveInvitedHousehold({
        userId: "U-second", inviteCode: "code-b", assignments,
        fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });

    assert.equal(a.householdId, "household:aaa");
    assert.equal(b.householdId, "household:bbb");
    assert.notEqual(a.householdId, b.householdId, "2世帯が同じ世帯に入ると記録が混ざる");
});

test("事前に世帯を割り当てた人は、その世帯へ入る", () => {
    const assignments = assignmentsFor({}, { "U-known": "household:ccc" });
    const resolved = resolveInvitedHousehold({
        userId: "U-known", assignments, fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });
    assert.equal(resolved.householdId, "household:ccc");
    assert.equal(resolved.via, "assignment:user");
});

test("割り当ての無い招待は通さない（既定世帯へ落とさない）", () => {
    const assignments = assignmentsFor({ [sha256("code-a")]: "household:aaa" });

    const unknownCode = resolveInvitedHousehold({
        userId: "U-stranger", inviteCode: "code-zzz", assignments,
        fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });
    const noCode = resolveInvitedHousehold({
        userId: "U-stranger", assignments, fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });

    assert.equal(unknownCode, null, "知らない招待コードが既定世帯へ入ると、他所帯の記録が見える");
    assert.equal(noCode, null);
});

test("旧来の招待は既定世帯のまま壊れない", () => {
    const viaUser = resolveInvitedHousehold({
        userId: "U-legacy",
        invitedUserIds: new Set(["U-legacy"]),
        fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });
    const viaCode = resolveInvitedHousehold({
        userId: "U-other",
        inviteCode: "legacy-code",
        legacyInviteCodeHash: sha256("legacy-code"),
        fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });

    assert.equal(viaUser.householdId, DEFAULT_HOUSEHOLD);
    assert.equal(viaUser.via, "legacy:user");
    assert.equal(viaCode.householdId, DEFAULT_HOUSEHOLD);
    assert.equal(viaCode.via, "legacy:code");
});

test("新しい割り当てが旧来の経路より優先される", () => {
    const assignments = assignmentsFor({}, { "U-legacy": "household:moved" });
    const resolved = resolveInvitedHousehold({
        userId: "U-legacy",
        invitedUserIds: new Set(["U-legacy"]),
        assignments,
        fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });
    assert.equal(resolved.householdId, "household:moved");
});

test("既定世帯が無ければ、旧来の招待でも通さない", () => {
    const resolved = resolveInvitedHousehold({
        userId: "U-legacy",
        invitedUserIds: new Set(["U-legacy"]),
        fallbackHouseholdId: "",
    });
    assert.equal(resolved, null);
});

test("壊れた設定は例外にせず、空として扱う", () => {
    const errors = [];
    const broken = parseInviteAssignments("{ this is not json", { onError: (m) => errors.push(m) });
    assert.equal(broken.codes.size, 0);
    assert.equal(broken.users.size, 0);
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].includes("this is not json"), "設定の中身をログに出さない");

    // 壊れていても、旧来の経路だけは生きている（既存世帯を止めない）
    const resolved = resolveInvitedHousehold({
        userId: "U-legacy",
        invitedUserIds: new Set(["U-legacy"]),
        assignments: broken,
        fallbackHouseholdId: DEFAULT_HOUSEHOLD,
    });
    assert.equal(resolved.householdId, DEFAULT_HOUSEHOLD);
});

test("形の違う世帯 id は受け付けない", () => {
    const errors = [];
    const assignments = parseInviteAssignments(JSON.stringify({
        codes: { [sha256("code-bad")]: "gutpacer-default" },   // household: が無い
        users: { "U-bad": "household:" + "x".repeat(65) },      // 長すぎる
    }), { onError: (m) => errors.push(m) });

    assert.equal(assignments.codes.size, 0);
    assert.equal(assignments.users.size, 0);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((m) => !m.includes("gutpacer-default")), "世帯名をログに出さない");

    assert.equal(isValidHouseholdId("household:ok-1"), true);
    assert.equal(isValidHouseholdId("household:"), false);
    assert.equal(isValidHouseholdId(null), false);
});

test("招待コードは前方一致や空文字で通らない", () => {
    const assignments = assignmentsFor({ [sha256("code-a")]: "household:aaa" });
    for (const code of ["", "code", "code-a ", " code-a", "CODE-A"]) {
        const resolved = resolveInvitedHousehold({
            userId: "U-x", inviteCode: code, assignments,
            fallbackHouseholdId: DEFAULT_HOUSEHOLD,
        });
        assert.equal(resolved, null, `"${code}" が通ってはいけない`);
    }
});
