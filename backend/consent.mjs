// 同意レコード（consent-record-v1）。COMP-01 Phase 2。
//
// スキーマの正本は veai-private の governance/consent-store/。
// **判定規則は Medication Promise と同一にする。** 実装は言語も構成も違うので
// コードは共有できないが、**振る舞いがずれると意味がない**ので、
// テストで同じ契約を固定する（tests/backend-consent.test.mjs）。
//
// ## 保存先について
//
// 設計は共通テーブル案だったが、Medication Promise と同じ判断で
// **各プロダクトの既存テーブルに載せる。** 共有ストアは3プロダクトの
// 同時停止点になり、fail closed と組むと記録そのものができなくなる
// （veai-private CLAUDE.md §2.6）。共有するのはストアではなくスキーマ。
//
// gutpacer-settings は `settingKey` の単一パーティションキーしか無いので、
// **1レコード=1アイテム**にして追記型にする（`consent#<type>#<id>`）。
// 1アイテムに配列で持つ形にすると read-modify-write になり、
// 追記が競合で消える余地ができる。
//
// 読み出しは Scan。**このテーブルは単一世帯用で数アイテムしかない**ので、
// Scan で問題ない。将来この判断が変わるなら、テーブル設計から見直すこと。

export const CONSENT_TYPES = ['basic', 'event_export', 'ai_analysis', 'third_party'];

export const CONSENT_PREREQUISITES = {
    basic: [],
    event_export: ['basic'],
    ai_analysis: ['basic'],
    third_party: ['basic', 'event_export'],
};

export const CONSENT_SETTING_PREFIX = 'consent#';

/** プライバシーポリシーの版。`frontend/privacy.html` の改定日と同じ日にする。 */
export const PRIVACY_POLICY_VERSION = '2026-08-24';

/** 同意画面で見せた文言の版。文言を変えたら上げる。 */
export const CONSENT_TEXT_VERSION = '2026-08-24-2';

export function makeConsentSettingKey(consentType, consentId) {
    return `${CONSENT_SETTING_PREFIX}${consentType}#${consentId}`;
}

export function isConsentType(value) {
    return typeof value === 'string' && CONSENT_TYPES.includes(value);
}

/**
 * 同じ種別が複数あるとき、どれが今の状態かを決める。
 * 最後に作られたものが勝つ。撤回してから同意し直す順序を正しく扱うため。
 * 同着は createdAt、それも同着なら consentId で決める（時計が粗いときに揺れない）。
 */
export function latestRecord(records) {
    if (!records || records.length === 0) return undefined;
    return [...records].sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.consentId < b.consentId ? 1 : -1;
    })[0];
}

/**
 * 保存されている status をそのまま信じない。
 * expiresAt を過ぎていれば expired。**期限切れは読み取り時に判定する。**
 */
export function effectiveStatus(record, now) {
    if (record.status === 'revoked') return 'revoked';
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
        return 'expired';
    }
    return record.status;
}

/**
 * ある種別の同意が今も有効かを、前提条件込みで判定する。
 *
 * **fail closed。** レコードが無い・期限切れ・撤回済み・前提条件が欠けている、
 * のいずれでも granted は false。
 *
 * `absent`（同意が無い）と `unavailable`（読めなかった）は**区別する**。
 * 混ぜると、DB が落ちただけで記録できなくなる。
 */
export function evaluateConsent(records, consentType, now) {
    const own = latestRecord((records || []).filter((r) => r.consentType === consentType));
    if (!own) return { granted: false, ownStatus: 'absent' };

    const ownStatus = effectiveStatus(own, now);
    if (ownStatus !== 'granted') return { granted: false, ownStatus };

    for (const prerequisite of CONSENT_PREREQUISITES[consentType]) {
        const upstream = evaluateConsent(records, prerequisite, now);
        if (!upstream.granted) return { granted: false, ownStatus, blockedBy: prerequisite };
    }
    return { granted: true, ownStatus };
}

export function evaluateAll(records, now) {
    const out = {};
    for (const type of CONSENT_TYPES) out[type] = evaluateConsent(records, type, now);
    return out;
}

/**
 * アプリ本体を使わせるかの判断。
 *
 * `state` が null は「サーバから状態を取れなかった」。
 * **ここで ask にしてはいけない。** 同意画面を出しても書き込みも失敗するので、
 * 利用者は記録できないまま閉じ込められる（CLAUDE.md §2.6）。
 */
export function decideAppGate(state) {
    if (state === null || state === undefined) {
        return { kind: 'allow-unverified' };
    }
    const basic = state.basic;
    if (basic && basic.granted) return { kind: 'allow' };
    if (basic && basic.ownStatus === 'unavailable') return { kind: 'allow-unverified' };
    return { kind: 'ask' };
}

/**
 * 研究用エクスポート等、**データを使う側**の判断。
 * こちらは確認できなければ通さない。アプリ本体とは基準が違う。
 */
export function mayUseForResearch(state) {
    if (!state) return false;
    return state.event_export?.granted === true;
}

/**
 * 同意レコードを組み立てる。AWS を呼ばずに中身を検算できるよう切り出す。
 * 監査情報は**渡されたときだけ**入れる。既定で集めない。
 */
export function buildGrantRecord(input, now) {
    const iso = now.toISOString();
    const record = {
        consentId: input.consentId,
        userId: input.userId,
        productId: 'gutpacer',
        consentType: input.consentType,
        status: 'granted',
        grantedAt: iso,
        ppVersion: input.ppVersion ?? PRIVACY_POLICY_VERSION,
        consentTextVersion: input.consentTextVersion ?? CONSENT_TEXT_VERSION,
        source: input.source ?? 'app_ui',
        createdAt: iso,
        updatedAt: iso,
    };
    if (input.expiresAt) record.expiresAt = input.expiresAt;
    if (input.ipAddress) record.ipAddress = input.ipAddress;
    if (input.userAgent) record.userAgent = input.userAgent;
    return record;
}

/**
 * 撤回。**元のレコードは書き換えず、撤回した新しいレコードを積む。**
 * いつ同意していつ撤回したかの両方を残す（監査要件）。
 */
export function buildRevokeRecord(previous, consentId, now) {
    const iso = now.toISOString();
    return {
        ...previous,
        consentId,
        status: 'revoked',
        revokedAt: iso,
        updatedAt: iso,
        createdAt: iso,
    };
}

/** 保存アイテムから同意レコードだけを取り出す。 */
export function extractConsentRecords(items) {
    return (items || [])
        .filter((i) => typeof i?.settingKey === 'string' && i.settingKey.startsWith(CONSENT_SETTING_PREFIX))
        .map((i) => i.record)
        .filter((r) => r && isConsentType(r.consentType));
}
