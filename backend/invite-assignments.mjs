import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 招待から**世帯**を決める。
 *
 * これが無いと、招待を満たした人が**全員同じ既定世帯**に入る。
 * 2世帯目を招いた瞬間、別の家の排便・服薬の記録がそのまま見える。
 * 記録を分ける単位は世帯であって個人ではない（issue #3・#4）ので、
 * **「誰を入れるか」と「どの家に入れるか」は別々に決める必要がある。**
 *
 * 形（環境変数 `INVITE_ASSIGNMENTS`・JSON）:
 *
 * ```json
 * {
 *   "codes": { "<招待コードの sha256(hex)>": "household:yamada" },
 *   "users": { "<LINE の userId>": "household:yamada" }
 * }
 * ```
 *
 * **値は運用上の秘密。** repo にも、Issue にも、PR にも書かない。
 * 招待コードの平文は保存せず、ハッシュだけを置く（既存の `INVITE_CODE_HASH` と同じ考え方）。
 *
 * 旧来の `INVITED_USER_IDS` / `INVITE_CODE_HASH` は**そのまま残す**。
 * それで入った人は既定世帯（いまの1世帯）に入る。既存の運用を壊さないため。
 */

// 世帯 id の形。ここを緩めると、設定の書き間違いがそのまま
// 「別世帯の記録が見える」に化ける。**迷ったら通さない。**
const HOUSEHOLD_ID_PATTERN = /^household:[A-Za-z0-9._:-]{1,64}$/;

export function isValidHouseholdId(value) {
    return typeof value === "string" && HOUSEHOLD_ID_PATTERN.test(value);
}

/**
 * `INVITE_ASSIGNMENTS` を読む。**壊れていたら例外にせず、空として扱う。**
 * 起動時に throw すると、設定を1文字間違えただけで
 * 既存世帯の記録まで読めなくなる。空なら旧来の経路だけが残り、
 * 新しい招待は「割り当て無し」で 403 になる（fail closed）。
 */
export function parseInviteAssignments(raw, { onError } = {}) {
    if (!raw || typeof raw !== "string" || raw.trim() === "") {
        return { codes: new Map(), users: new Map() };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        // **値は出さない。** 招待コードのハッシュも世帯名も残さない。
        onError?.(`INVITE_ASSIGNMENTS is not valid JSON (${error.name})`);
        return { codes: new Map(), users: new Map() };
    }
    return {
        codes: toHouseholdMap(parsed?.codes, "codes", onError),
        users: toHouseholdMap(parsed?.users, "users", onError)
    };
}

function toHouseholdMap(source, label, onError) {
    const map = new Map();
    if (!source || typeof source !== "object" || Array.isArray(source)) return map;
    for (const [key, value] of Object.entries(source)) {
        if (!key) continue;
        if (!isValidHouseholdId(value)) {
            // どのキーが悪いかは出さない（キーは招待コードのハッシュ）。件数だけ分かれば直せる。
            onError?.(`INVITE_ASSIGNMENTS.${label} has an entry with an invalid household id`);
            continue;
        }
        map.set(key, value);
    }
    return map;
}

function sha256Hex(value) {
    return createHash("sha256").update(value).digest("hex");
}

function hashesMatch(code, expectedHash) {
    if (!code || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
    const actual = createHash("sha256").update(code).digest();
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 招待を確かめ、入るべき世帯を返す。**決められなければ null。**
 *
 * 優先順:
 *   1. `users[userId]`      — 事前に世帯を割り当てた人
 *   2. `codes[sha256(code)]`— 招待コードごとの世帯
 *   3. 旧 `INVITED_USER_IDS`  — 既定世帯（いまの1世帯）
 *   4. 旧 `INVITE_CODE_HASH`  — 既定世帯（いまの1世帯）
 *
 * ⚠️ **割り当ての無い招待を既定世帯へ落とさない。** 落とすと、
 * 2世帯目が1世帯目の記録をそのまま見ることになる。
 */
export function resolveInvitedHousehold({
    userId,
    inviteCode,
    assignments = { codes: new Map(), users: new Map() },
    invitedUserIds = new Set(),
    legacyInviteCodeHash = "",
    fallbackHouseholdId
} = {}) {
    const assignedToUser = userId ? assignments.users?.get(userId) : undefined;
    if (isValidHouseholdId(assignedToUser)) {
        return { householdId: assignedToUser, via: "assignment:user" };
    }

    if (inviteCode) {
        const assignedToCode = assignments.codes?.get(sha256Hex(inviteCode));
        if (isValidHouseholdId(assignedToCode)) {
            return { householdId: assignedToCode, via: "assignment:code" };
        }
    }

    // ここから下は既存の1世帯向けの経路。既定世帯が無ければ通さない。
    if (!isValidHouseholdId(fallbackHouseholdId)) return null;

    if (userId && invitedUserIds.has(userId)) {
        return { householdId: fallbackHouseholdId, via: "legacy:user" };
    }
    if (hashesMatch(inviteCode, legacyInviteCodeHash)) {
        return { householdId: fallbackHouseholdId, via: "legacy:code" };
    }
    return null;
}
