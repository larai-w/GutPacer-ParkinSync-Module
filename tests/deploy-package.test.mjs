// デプロイの同梱漏れを検知する。
//
// 2026-08-24 に踏んだ穴: `backend/consent.mjs` を追加して index.mjs から
// import したが、deploy-api.yml は `zip -j function.zip backend/index.mjs` の
// ままだった。**デプロイすると Lambda が起動時の import で落ちる**
// （Cannot find module './consent.mjs'）。API 全体が止まる。
//
// **zip は成功し、npm test も緑、CI も緑になる。** 実際に Lambda が
// 呼ばれるまで誰も気づけない。だから機械で見る。
//
// 同じ理由で、`on.push.paths` にも import 先が入っていないと、
// そのファイルだけを直したときに deploy が走らない。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const WORKFLOW = ".github/workflows/deploy-api.yml";
const ENTRY = "backend/index.mjs";

/** ファイル内の相対 import を集める（複数行 import にも対応）。 */
function relativeImports(file) {
    const src = readFileSync(file, "utf8");
    const found = new Set();
    // import ... from "./x.mjs" / export ... from "./x.mjs" / import("./x.mjs")
    for (const m of src.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) found.add(m[1]);
    for (const m of src.matchAll(/import\(\s*["'](\.\/[^"']+)["']\s*\)/g)) found.add(m[1]);
    return [...found];
}

/** エントリから辿れる相対 import を全部集める（推移的）。 */
function transitiveLocalModules(entry) {
    const dir = entry.slice(0, entry.lastIndexOf("/") + 1);
    const seen = new Set();
    const queue = [entry];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const rel of relativeImports(current)) {
            const path = dir + rel.replace(/^\.\//, "");
            if (seen.has(path)) continue;
            seen.add(path);
            queue.push(path);
        }
    }
    return [...seen];
}

const workflow = readFileSync(WORKFLOW, "utf8");
const zipLine = workflow.split("\n").find((l) => l.includes("zip -j function.zip"));

test("zip のコマンドが workflow に存在する", () => {
    assert.ok(zipLine, `${WORKFLOW} に zip -j function.zip の行が無い`);
});

test("index.mjs が import しているモジュールが全部 zip に入っている", () => {
    const modules = transitiveLocalModules(ENTRY);
    assert.ok(modules.length > 0, "相対 import が1つも見つからない（検出が壊れている可能性）");

    for (const m of modules) {
        assert.ok(
            zipLine.includes(m),
            `${m} が zip に含まれていない。デプロイすると Lambda が import で落ちる（${zipLine.trim()}）`,
        );
    }
});

test("ハンドラの入口そのものが zip に入っている", () => {
    assert.ok(zipLine.includes(ENTRY), `${ENTRY} が zip に含まれていない`);
});

test("import しているモジュールが push の paths に入っている", () => {
    // そのファイルだけを直したときに deploy が走らないと、本番が古いままになる。
    const onBlock = workflow.slice(0, workflow.indexOf("jobs:"));
    const modules = transitiveLocalModules(ENTRY);
    for (const m of modules) {
        const dir = m.slice(0, m.lastIndexOf("/"));
        const covered =
            onBlock.includes(m) ||            // 明示
            onBlock.includes(`${dir}/*.mjs`) || // ワイルドカード
            onBlock.includes(`${dir}/**`);
        assert.ok(covered, `${m} が on.push.paths に入っていない。直しても deploy が走らない`);
    }
});

test("zip に入れているファイルが実在する", () => {
    for (const m of zipLine.matchAll(/backend\/[\w.-]+\.mjs/g)) {
        assert.doesNotThrow(
            () => readFileSync(m[0], "utf8"),
            `zip に指定された ${m[0]} が存在しない。デプロイが失敗する`,
        );
    }
});
