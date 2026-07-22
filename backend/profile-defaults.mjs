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

export function createDefaultProfile(userId, now = new Date().toISOString()) {
    return {
        userId,
        ...structuredClone(DEFAULT_PROFILE),
        createdAt: now,
        updatedAt: now
    };
}
