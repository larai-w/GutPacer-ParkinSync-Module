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

test("旧実装を出すワークフローは自動で走らない", () => {
  // **起動条件を絞るだけでは足りなかった。**
  //
  // 2026-08-27 に2回、本番を旧実装で上書きした:
  //   1回目 paths が `backend/notifier/**` で、別の PR に反応した
  //   2回目 paths を絞ったが、**ワークフロー自身**も paths に入っていたため、
  //         「起動条件を直す PR」そのもので起動した
  //
  // 同じ関数を出すワークフローが複数あるなら、
  // **本番で動いていないほうは自動で走らせない。**
  const all = workflows().map((w) => ({
    ...w,
    functions: deployedFunctions(w.src),
    paths: pushPaths(w.src),
    packaged: packagedFiles(w.src),
  }));

  const byFunction = {};
  for (const w of all) {
    for (const fn of w.functions) (byFunction[fn] ||= []).push(w);
  }

  for (const [fn, group] of Object.entries(byFunction)) {
    if (group.length < 2) continue;
    const auto = group.filter((w) => w.paths.length > 0);
    // ⚠️ 最初は「自動は1つまで」にしていたが、**それでは今日の1回目を捕まえられない。**
    // 旧実装のほうが自動になっていても、自動は1つだから通ってしまった。
    //
    // **どちらが正なのかは機械には分からない。**
    // 複数が同じ関数を出すなら、**どれも自動にしない**のが唯一安全な形。
    // 出すときは、どちらを出すか人が選ぶ。
    assert.equal(
      auto.length,
      0,
      `${fn} を出すワークフローが ${group.length} つあるのに、` +
        `${auto.length} つが自動で走る（${auto.map((w) => w.name).join(", ")}）。` +
        `どちらが正か機械には分からない。後に走ったほうが勝ち、本番が上書きされる`
    );
  }
});

test("ワークフローが自分自身の変更で起動しない（同じ関数を複数が出す場合）", () => {
  // 「起動条件を直す PR」で起動して本番を壊した、を繰り返さない。
  const all = workflows().map((w) => ({
    ...w,
    functions: deployedFunctions(w.src),
    paths: pushPaths(w.src),
  }));
  const shared = new Set();
  const byFunction = {};
  for (const w of all) for (const fn of w.functions) (byFunction[fn] ||= []).push(w.name);
  for (const [, names] of Object.entries(byFunction)) {
    if (names.length > 1) names.forEach((n) => shared.add(n));
  }

  for (const w of all) {
    if (!shared.has(w.name)) continue;
    const selfPath = `.github/workflows/${w.name}`;
    assert.ok(
      !w.paths.includes(selfPath),
      `${w.name} が自分自身を paths に入れている。` +
        `起動条件を直す PR そのもので起動し、本番を上書きする（2026-08-27 に発生）`
    );
  }
});
