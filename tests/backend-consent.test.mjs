// 同意判定の回帰テスト（COMP-01 Phase 2）。AWS は呼ばない。
//
// **Medication Promise と同じ契約であることを、ここで固定する。**
// 実装は言語も構成も違うのでコードは共有できない。振る舞いがずれると
// 「同じスキーマなのに判定が違う」ことになるので、テストを揃える。
//
// 守りたい不変条件:
//   1. こちらの障害で、記録を止めない
//   2. 研究へのデータ利用は、確認できなければ通さない

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    CONSENT_SETTING_PREFIX,
    CONSENT_TEXT_VERSION,
    PRIVACY_POLICY_VERSION,
    buildGrantRecord,
    buildRevokeRecord,
    decideAppGate,
    effectiveStatus,
    evaluateAll,
    evaluateConsent,
    extractConsentRecords,
    isConsentType,
    latestRecord,
    makeConsentSettingKey,
    mayUseForResearch,
} from "../backend/consent.mjs";

const NOW = new Date("2026-08-24T10:00:00.000Z");

function rec(over) {
    return {
        consentId: over.consentId ?? `c-${over.consentType}`,
        userId: "household-1",
        productId: "gutpacer",
        status: "granted",
        grantedAt: "2026-08-01T00:00:00.000Z",
        ppVersion: "2026-08-24",
        consentTextVersion: "2026-08-24",
        source: "app_ui",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...over,
    };
}

function state(over = {}) {
    const absent = { granted: false, ownStatus: "absent" };
    return { basic: absent, event_export: absent, ai_analysis: absent, third_party: absent, ...over };
}

// ── キーと種別 ────────────────────────────────────────────────────────────
test("設定キーは consent# で始まり、他の設定と混ざらない", () => {
    const k = makeConsentSettingKey("event_export", "abc");
    assert.equal(k, "consent#event_export#abc");
    assert.ok(k.startsWith(CONSENT_SETTING_PREFIX));
    assert.notEqual(k, "location");
});

test("知らない種別は受け付けない", () => {
    assert.equal(isConsentType("basic"), true);
    assert.equal(isConsentType("marketing"), false);
    assert.equal(isConsentType(""), false);
    assert.equal(isConsentType(null), false);
});

// ── 判定 ──────────────────────────────────────────────────────────────────
test("レコードが無ければ granted にならない", () => {
    const r = evaluateConsent([], "basic", NOW);
    assert.equal(r.granted, false);
    assert.equal(r.ownStatus, "absent");
});

test("撤回済みは granted にならない", () => {
    const r = evaluateConsent([rec({ consentType: "basic", status: "revoked" })], "basic", NOW);
    assert.equal(r.granted, false);
    assert.equal(r.ownStatus, "revoked");
});

test("expiresAt を過ぎていれば、status が granted のままでも expired", () => {
    const expired = rec({ consentType: "basic", expiresAt: "2026-08-24T09:59:59.000Z" });
    assert.equal(effectiveStatus(expired, NOW), "expired");
    assert.equal(evaluateConsent([expired], "basic", NOW).granted, false);
});

test("expiresAt ちょうどは切れている扱い", () => {
    assert.equal(effectiveStatus(rec({ consentType: "basic", expiresAt: NOW.toISOString() }), NOW), "expired");
});

test("前提条件が欠けていれば granted にならない（basic 無しの event_export）", () => {
    const r = evaluateConsent([rec({ consentType: "event_export" })], "event_export", NOW);
    assert.equal(r.granted, false);
    assert.equal(r.ownStatus, "granted", "それ自体は granted のはず");
    assert.equal(r.blockedBy, "basic");
});

test("basic を撤回すると event_export も落ちる", () => {
    const records = [rec({ consentType: "basic", status: "revoked" }), rec({ consentType: "event_export" })];
    assert.equal(evaluateConsent(records, "event_export", NOW).blockedBy, "basic");
});

test("third_party は basic と event_export の両方が要る", () => {
    const partial = [rec({ consentType: "basic" }), rec({ consentType: "third_party" })];
    assert.equal(evaluateConsent(partial, "third_party", NOW).blockedBy, "event_export");

    const full = [
        rec({ consentType: "basic" }),
        rec({ consentType: "event_export" }),
        rec({ consentType: "third_party" }),
    ];
    assert.equal(evaluateConsent(full, "third_party", NOW).granted, true);
});

test("同じ種別が複数あるとき、最後のものが勝つ", () => {
    const records = [
        rec({ consentType: "basic", consentId: "old", updatedAt: "2026-08-01T00:00:00.000Z" }),
        rec({ consentType: "basic", consentId: "new", status: "revoked", updatedAt: "2026-08-20T00:00:00.000Z" }),
    ];
    assert.equal(latestRecord(records).consentId, "new");
    assert.equal(evaluateConsent(records, "basic", NOW).granted, false);
});

test("撤回してから同意し直した順序を正しく読む", () => {
    const records = [
        rec({ consentType: "basic", consentId: "a", updatedAt: "2026-08-01T00:00:00.000Z" }),
        rec({ consentType: "basic", consentId: "b", status: "revoked", updatedAt: "2026-08-10T00:00:00.000Z" }),
        rec({ consentType: "basic", consentId: "c", updatedAt: "2026-08-20T00:00:00.000Z" }),
    ];
    assert.equal(evaluateConsent(records, "basic", NOW).granted, true);
});

test("配列の順番を変えても結果が変わらない", () => {
    const records = [
        rec({ consentType: "basic", consentId: "a", updatedAt: "2026-08-01T00:00:00.000Z" }),
        rec({ consentType: "basic", consentId: "b", status: "revoked", updatedAt: "2026-08-10T00:00:00.000Z" }),
    ];
    const f = evaluateConsent(records, "basic", NOW).granted;
    assert.equal(f, evaluateConsent([...records].reverse(), "basic", NOW).granted);
    assert.equal(f, false);
});

test("evaluateAll は4種別すべてを返し、既定はすべて granted でない", () => {
    const all = evaluateAll([], NOW);
    assert.deepEqual(Object.keys(all).sort(), ["ai_analysis", "basic", "event_export", "third_party"]);
    for (const [type, v] of Object.entries(all)) {
        assert.equal(v.granted, false, `${type} が既定で granted になっている`);
    }
});

// ── ここが本題: 障害で記録を止めない ───────────────────────────────────────
test("状態を取れなくても、記録は止めない", () => {
    const d = decideAppGate(null);
    assert.equal(d.kind, "allow-unverified");
    assert.notEqual(d.kind, "ask", "同意画面を出すと、押した先の書き込みも失敗して閉じ込める");
});

test("読み取り失敗（unavailable）でも、記録は止めない", () => {
    assert.equal(decideAppGate(state({ basic: { granted: false, ownStatus: "unavailable" } })).kind, "allow-unverified");
});

test("同意していなければ同意画面を出す", () => {
    assert.equal(decideAppGate(state()).kind, "ask");
});

test("撤回・期限切れも、改めて同意を取る", () => {
    for (const s of ["revoked", "expired"]) {
        assert.equal(decideAppGate(state({ basic: { granted: false, ownStatus: s } })).kind, "ask", `${s}`);
    }
});

test("同意済みならそのまま使える", () => {
    assert.equal(decideAppGate(state({ basic: { granted: true, ownStatus: "granted" } })).kind, "allow");
});

// ── 研究利用は基準が違う ───────────────────────────────────────────────────
test("研究利用は、確認できなければ通さない", () => {
    assert.equal(mayUseForResearch(null), false);
    assert.equal(mayUseForResearch(state({ event_export: { granted: false, ownStatus: "unavailable" } })), false);
});

test("研究利用は event_export が granted のときだけ通す", () => {
    assert.equal(mayUseForResearch(state()), false);
    assert.equal(mayUseForResearch(state({ event_export: { granted: true, ownStatus: "granted" } })), true);
});

test("アプリ利用と研究利用で基準が違うことを、同じ入力で確認する", () => {
    const unavailable = state({
        basic: { granted: false, ownStatus: "unavailable" },
        event_export: { granted: false, ownStatus: "unavailable" },
    });
    assert.equal(decideAppGate(unavailable).kind, "allow-unverified", "記録は続けられる");
    assert.equal(mayUseForResearch(unavailable), false, "でも研究には使わない");
});

// ── レコード組み立て ───────────────────────────────────────────────────────
test("buildGrantRecord は監査情報を渡されたときだけ入れる", () => {
    const bare = buildGrantRecord({ consentId: "c1", userId: "h1", consentType: "basic" }, NOW);
    assert.equal(bare.ipAddress, undefined);
    assert.equal(bare.userAgent, undefined);
    assert.equal(bare.expiresAt, undefined);
    assert.equal(bare.productId, "gutpacer");
    assert.equal(bare.status, "granted");
    assert.equal(bare.grantedAt, NOW.toISOString());
    assert.equal(bare.ppVersion, PRIVACY_POLICY_VERSION);
    assert.equal(bare.consentTextVersion, CONSENT_TEXT_VERSION);

    const audited = buildGrantRecord(
        { consentId: "c2", userId: "h1", consentType: "basic", ipAddress: "203.0.113.1", userAgent: "ua" },
        NOW,
    );
    assert.equal(audited.ipAddress, "203.0.113.1");
    assert.equal(audited.userAgent, "ua");
});

test("撤回は元のレコードを書き換えず、新しいレコードを積む", () => {
    const granted = buildGrantRecord(
        { consentId: "c1", userId: "h1", consentType: "event_export" },
        new Date("2026-08-01T00:00:00.000Z"),
    );
    const revoked = buildRevokeRecord(granted, "c2", NOW);

    assert.equal(granted.status, "granted", "元のレコードが書き換わっている");
    assert.equal(granted.revokedAt, undefined);
    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.revokedAt, NOW.toISOString());
    assert.equal(revoked.consentId, "c2");
    assert.equal(revoked.grantedAt, granted.grantedAt, "いつ同意したかは撤回レコードにも残す");
    assert.equal(evaluateConsent([granted, revoked], "event_export", NOW).ownStatus, "revoked");
});

// ── 保存アイテムからの取り出し ─────────────────────────────────────────────
test("同意以外の設定を巻き込まない", () => {
    const items = [
        { settingKey: "location", value: "home" },
        { settingKey: makeConsentSettingKey("basic", "c1"), record: rec({ consentType: "basic" }) },
        { settingKey: "consent#bogus#c2", record: rec({ consentType: "marketing" }) },
        { settingKey: makeConsentSettingKey("event_export", "c3"), record: null },
    ];
    const out = extractConsentRecords(items);
    assert.equal(out.length, 1, "location や不正な種別を拾っている");
    assert.equal(out[0].consentType, "basic");
});

test("空でも落ちない", () => {
    assert.deepEqual(extractConsentRecords([]), []);
    assert.deepEqual(extractConsentRecords(undefined), []);
});

test("ポリシーの版が privacy.html の改定日と実際に一致している", () => {
    // 名前だけそう言って中身を見ていなかった（2026-08-24 に気づいた）。
    // ずれていると、同意記録の ppVersion が「何に同意したか」を指さなくなる。
    assert.match(PRIVACY_POLICY_VERSION, /^\d{4}-\d{2}-\d{2}$/, "版の形が違う");
    const html = readFileSync("frontend/privacy.html", "utf8");
    const m = html.match(/改定日:\s*(\d{4}-\d{2}-\d{2})/);
    assert.ok(m, "privacy.html に改定日が見つからない");
    assert.equal(
        PRIVACY_POLICY_VERSION,
        m[1],
        `版(${PRIVACY_POLICY_VERSION}) と privacy.html の改定日(${m[1]}) がずれている`,
    );
});

test("文言の版は YYYY-MM-DD か YYYY-MM-DD-N（同日に2回直すことがある）", () => {
    const m = CONSENT_TEXT_VERSION.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/);
    assert.ok(m, `版の形が違う: ${CONSENT_TEXT_VERSION}`);
    assert.ok(!Number.isNaN(new Date(m[1]).getTime()), `日付として読めない: ${m[1]}`);
    if (m[2]) assert.ok(Number(m[2]) >= 2, "同日の連番は 2 から始める");
});
