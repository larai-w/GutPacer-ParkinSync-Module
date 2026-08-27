import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WF = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");

// 同じ Lambda を、別のワークフローが**別のソースから**デプロイしている。
//
//   deploy-notifier.yml      -> backend/notifier/index.mjs      （旧実装）
//   deploy-closed-beta.yml   -> backend/notifier/index-mvp.mjs  （本番で動く実装）
//
// 後に走ったほうが勝つ。2026-08-27、issue #3 の PR が backend/notifier/ 配下に
// 触れたため deploy-notifier.yml が起動し、**世帯対応済みの notifier が
// 旧テーブル直書きの実装へ戻った。** マージの数十秒後に本番が逆戻りした。
//
// 押さえる不変条件:
//   **自動起動の paths が、別のワークフローが出すファイルに一致しないこと。**

function workflows() {
  return readdirSync(WF)
    .filter((f) => f.endsWith(".yml"))
    .map((f) => ({ name: f, src: readFileSync(join(WF, f), "utf8") }));
}

/** そのワークフローがデプロイする Lambda 関数名 */
function deployedFunctions(src) {
  return [...new Set([...src.matchAll(/--function-name\s+([a-z0-9-]+)/g)].map((m) => m[1]))];
}

/** そのワークフローが zip に入れるソースファイル */
function packagedFiles(src) {
  const files = [];
  for (const m of src.matchAll(/(?:cp|zip -j function\.zip)\s+(backend\/[^\s]+\.mjs)/g)) {
    files.push(m[1]);
  }
  return [...new Set(files)];
}

/** push トリガーの paths（コメント行は拾わない） */
function pushPaths(src) {
  const head = src.split(/\njobs:/)[0];
  if (!/\n\s*push:/.test(head)) return [];
  const seg = head.split(/\n\s*push:/)[1] || "";
  return [...seg.matchAll(/^\s*-\s*'([^']+)'/gm)].map((m) => m[1]);
}

function matches(pattern, file) {
  const re = new RegExp(
    "^" + pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "[^/]*")
      .replace(//g, ".*") + "$"
  );
  return re.test(file);
}

test("自動デプロイの起動条件が、別のワークフローが出すファイルに一致しない", () => {
  const all = workflows().map((w) => ({
    ...w,
    packaged: packagedFiles(w.src),
    paths: pushPaths(w.src),
    functions: deployedFunctions(w.src),
  }));

  const problems = [];
  for (const w of all) {
    if (w.paths.length === 0) continue; // 手動のみ
    for (const other of all) {
      if (other.name === w.name) continue;
      // **危ないのは「同じ関数を別ソースから出す」場合だけ。**
      // 関数が違えば、余計なデプロイが走るだけで上書きは起きない。
      // ここを広く取ると誤検知になり、**誤検知するガードは読み飛ばされる。**
      const sameFunction = other.functions.some((f) => w.functions.includes(f));
      if (!sameFunction) continue;
      for (const f of other.packaged) {
        if (w.packaged.includes(f)) continue; // 同じものを出すなら問題ない
        for (const p of w.paths) {
          if (matches(p, f)) {
            problems.push(
              `${w.name} の paths '${p}' が ${other.name} の出す ${f} に一致する`
            );
          }
        }
      }
    }
  }

  assert.deepEqual(
    problems,
    [],
    "別のワークフローのソースを触っただけで自動デプロイが走る。\n" +
      "**本番が別の実装で上書きされる**（2026-08-27 に実際に起きた）:\n  " +
      problems.join("\n  ")
  );
});

test("同じ関数を出すワークフローは、互いの名前を書いている", () => {
  // 気づけるようにしておく。**知らないまま触るのが一番危ない。**
  //
  // ⚠️ 最初は「legacy か 旧実装 の語があるか」で見ていたが、
  // **別の箇所の同じ語に当たって通ってしまった**（2026-08-27）。
  // 語ではなく、**相手のファイル名が書かれているか**を見る。
  // これなら「どちらを見ればいいか」が必ず分かる。
  const byFunction = {};
  for (const w of workflows()) {
    for (const fn of deployedFunctions(w.src)) {
      (byFunction[fn] ||= new Set()).add(w.name);
    }
  }
  for (const [fn, names] of Object.entries(byFunction)) {
    if (names.size < 2) continue;
    for (const n of names) {
      const src = readFileSync(join(WF, n), "utf8");
      for (const other of names) {
        if (other === n) continue;
        assert.ok(
          src.includes(other),
          `${fn} を ${[...names].join(" と ")} の両方がデプロイしている。` +
            `${n} に相手（${other}）の名前が書かれていない。` +
            `片方だけ直すと、もう片方が本番を上書きする`
        );
      }
    }
  }
});
