// retention-report.mjs
//
// 用途: gutpacer-logs-v2 テーブルを集計し、「週3日以上×N週間連続で記録している
//       家族(userId)が何組いるか」を算出する。Phase 1 GO/NO-GO 判断の継続率ゲート確認用。
//
// 注意:
//   - 読み取り専用。Scan のみ実行。テーブルへの書き込みは一切行わない。
//   - ローカル環境または CloudShell 上で、有効な AWS 認証情報を持った状態で実行すること。
//   - 出力の perFamily に LINE userId (sub) がフルで含まれる。
//     運用者本人がローカルで実行する前提のスクリプトである。
//     出力をチャット・メール等に貼り付ける際には userId をマスクすること。
//
// 実行:
//   npm run report:retention
//   # 集計窓を変えたい場合
//   WEEKS=6 npm run report:retention
//   END_DATE=2026-07-14 npm run report:retention

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// --- 設定 ---
const LOGS_TABLE = process.env.NEW_LOGS_TABLE || "gutpacer-logs-v2";
const region = process.env.AWS_REGION || "us-east-1";
const WEEKS = parseInt(process.env.WEEKS || "4", 10);
const MIN_DAYS_PER_WEEK = 3;  // 継続とみなす閾値: 週あたりの最低記録日数

// --- JST 今日の日付を取得 (notifier と同じ手法) ---
function getJSTToday() {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

// --- END_DATE の検証 ---
function parseEndDate() {
    const raw = process.env.END_DATE;
    if (!raw) return getJSTToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        console.error(`ERROR: END_DATE の形式が不正です: "${raw}". YYYY-MM-DD 形式で指定してください。`);
        process.exit(1);
    }
    return raw;
}

// --- 週バケットを生成 ---
// END_DATE を最終日とする WEEKS 個のバケット [{ start, end }] を古い順で返す。
// 各バケットは 7 日間: end が最新、start = end から 6 日遡った日。
//
// 例: END_DATE=2026-07-22, WEEKS=4
//   week[0]: 2026-06-25 〜 2026-07-01  (最古)
//   week[1]: 2026-07-02 〜 2026-07-08
//   week[2]: 2026-07-09 〜 2026-07-15
//   week[3]: 2026-07-16 〜 2026-07-22  (最新)
function buildWeekRanges(endDate, weeks) {
    // 文字列の日付加算を行うユーティリティ (JST タイムゾーン依存を避けるため UTC midnight で計算)
    function addDays(dateStr, days) {
        const d = new Date(dateStr + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().split("T")[0];
    }

    const ranges = [];
    // 最新週の end = endDate
    let currentEnd = endDate;
    for (let i = 0; i < weeks; i++) {
        const start = addDays(currentEnd, -6);
        ranges.unshift({ start, end: currentEnd }); // 先頭に追加して古い順にする
        currentEnd = addDays(start, -1); // 次の週の end は今の start の前日
    }
    return ranges;
}

// --- DynamoDB 全件 Scan (ページング対応) ---
async function scanAll(client, tableName) {
    const items = [];
    let ExclusiveStartKey;
    do {
        const result = await client.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey
        }));
        items.push(...(result.Items || []));
        ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}

// --- 集計ロジック (純粋関数: AWS 依存なし) ---
// 仕様:
//   items: [{ userId, fullDate, ...any }]
//   weekRanges: [{ start, end }]  (古い順)
// 返値:
//   [{ userId, weeklyActiveDays: [n, ...], totalActiveDays, continuing }]
export function aggregateRetention(items, weekRanges) {
    // userId ごとに記録済み fullDate のセットを構築
    const activeDatesByUser = new Map();
    for (const item of items) {
        const { userId, fullDate } = item;
        if (!userId || !fullDate) continue;
        if (!activeDatesByUser.has(userId)) {
            activeDatesByUser.set(userId, new Set());
        }
        activeDatesByUser.get(userId).add(fullDate);
    }

    const perFamily = [];
    for (const [userId, dates] of activeDatesByUser) {
        // 各週の active 日数を計算
        const weeklyActiveDays = weekRanges.map(({ start, end }) => {
            let count = 0;
            for (const d of dates) {
                if (d >= start && d <= end) count++;
            }
            return count;
        });

        const totalActiveDays = weeklyActiveDays.reduce((a, b) => a + b, 0);

        // 継続判定: 全週で MIN_DAYS_PER_WEEK 以上
        const continuing = weeklyActiveDays.every((n) => n >= MIN_DAYS_PER_WEEK);

        perFamily.push({ userId, weeklyActiveDays, totalActiveDays, continuing });
    }

    // userId でソートして出力を安定させる
    perFamily.sort((a, b) => a.userId.localeCompare(b.userId));
    return perFamily;
}

// --- メイン ---
// import 時には実行されず、直接起動 (npm run report:retention) のときだけ走る。
// これにより aggregateRetention をテストから安全に import できる。
async function main() {
    const endDate = parseEndDate();
    const weekRanges = buildWeekRanges(endDate, WEEKS);

    console.error(`[retention-report] table=${LOGS_TABLE} region=${region}`);
    console.error(`[retention-report] window: ${weekRanges[0].start} 〜 ${endDate} (${WEEKS}週)`);
    console.error("[retention-report] Scanning...");

    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    const items = await scanAll(client, LOGS_TABLE);
    console.error(`[retention-report] ${items.length} 件取得完了`);

    const perFamily = aggregateRetention(items, weekRanges);
    const continuingFamilies = perFamily.filter((f) => f.continuing).length;
    const totalFamilies = perFamily.length;
    const gate = continuingFamilies >= 5 ? "expand" : "hold";

    const report = {
        window: {
            endDate,
            weeks: WEEKS,
            minDaysPerWeek: MIN_DAYS_PER_WEEK,
            weekRanges
        },
        totalFamilies,
        continuingFamilies,
        gate,
        // gate の意味:
        //   "expand" ... 継続 5 組以上 → 30 人への拡大継続の参考
        //   "hold"   ... 継続 5 組未満 → 拡大停止の参考
        // ※ あくまで機械的な集計値。最終判断は運用者が行うこと。
        perFamily
    };

    console.log(JSON.stringify(report, null, 2));
}

// 直接起動されたときだけ main を実行する (import 時は実行しない)
const invokedDirectly = process.argv[1] &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
    await main();
}
