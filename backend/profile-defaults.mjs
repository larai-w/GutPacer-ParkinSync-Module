export const DEFAULT_PROFILE = Object.freeze({
    meds: [
        { id: "movicol", name: "モビコール", slots: ["朝", "昼", "夜"] }
    ],
    stoolTypes: [
        "硬い（コロコロ）",
        "柔らかい（軟便）",
        "水っぽい（下痢）",
        "普通（バナナ状）"
    ],
    notify: {
        remindAfterDays: 1,
        warnAfterDays: 2
    },
    location: "home"
});

export function createDefaultProfile(userId, now = new Date().toISOString(), householdId = null) {
    return {
        userId,
        // 記録を分ける単位は**世帯**であって個人ではない（issue #3・#4）。
        // 個人の userId をキーにすると、招待された2人目の介護者が
        // **同じ家の記録を見られない**。プロフィールで世帯へ結び付ける。
        householdId: householdId || defaultHouseholdId(),
        ...structuredClone(DEFAULT_PROFILE),
        createdAt: now,
        updatedAt: now
    };
}

/**
 * 世帯 id の既定値。単一世帯のうちは環境変数（または固定値）で足りる。
 * 世帯が増えたら、招待の時点で発行して渡す（#4）。
 * **同意記録と同じ値を使うこと。** 別々に持つと対象がずれる。
 */
export function defaultHouseholdId() {
    return process.env.HOUSEHOLD_ID
        || process.env.CONSENT_SUBJECT
        || "household:gutpacer-default";
}
