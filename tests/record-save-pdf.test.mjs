import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
function setup({ existing = [], confirm = true, fail = false, pending = false } = {}) {
    const fields = Object.fromEntries(['logDate','stoolType','logNotes','stoolDifficult','careEnema','careManual','medMorning','medNoon','medEvening','saveBtn','saveConfirmationDetails'].map(id => [id, {value:'',checked:false,disabled:false,textContent:''}]));
    fields.logDate.value = '2026-09-07';
    fields.logNotes.value = '朝の記録';
    let release;
    const gate = pending ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
    const writes = [];
    const alerts = [];
    const ctx = vm.createContext({
        document: {getElementById: id => fields[id]}, selectedConditionValue: 0, selectedAmountValue: '', currentLogs: existing,
        confirm: () => confirm, alert: s => alerts.push(s), API_URL: 'https://simulation.test/api', getAuthHeaders: () => ({}),
        fetch: async (_, req) => { writes.push(JSON.parse(req.body)); await gate; return {ok:!fail,status:fail?500:200}; },
        recordTimeTracker: {stop: async () => {}}, showSaveConfirmation: () => {},
        resetForm: () => { fields.logNotes.value = ''; }, fetchDataFromServer: async () => {},
        handleUnauthorized: () => {},
    });
    vm.runInContext(html.slice(html.indexOf('        function captureLogForm()'), html.indexOf('        // 履歴の内容をフォーム')), ctx);
    return {ctx, fields, writes, alerts, release};
}
test('既存日付の置換を取り消すと送信せず入力を残す', async () => {
    const s = setup({existing:[{fullDate:'2026-09-07'}],confirm:false});
    await s.ctx.saveGutLog();
    assert.equal(s.writes.length,0);
    assert.equal(s.fields.logNotes.value,'朝の記録');
});
test('保存失敗は入力を保持して再操作可能にする', async () => {
    const s=setup({fail:true}); await s.ctx.saveGutLog();
    assert.equal(s.fields.logNotes.value,'朝の記録');
    assert.equal(s.fields.saveBtn.disabled,false);
    assert.equal(s.alerts.length,1);
});
test('通信中の追加入力は成功応答でも消さず二重送信を防ぐ', async () => {
    const s=setup({pending:true}); const first=s.ctx.saveGutLog();
    s.fields.logNotes.value='夜の追記';
    await s.ctx.saveGutLog(); s.release(); await first;
    assert.equal(s.writes.length,1);
    assert.equal(s.writes[0].notes,'朝の記録');
    assert.equal(s.fields.logNotes.value,'夜の追記');
    assert.match(s.fields.saveConfirmationDetails.textContent,/未保存/);
});
test('入力に変更がなければ保存成功後にリセットする', async () => {
    const s=setup(); await s.ctx.saveGutLog(); assert.equal(s.fields.logNotes.value,'');
});
test('PDFは未記録を未服用と断定せず年を含めて出力する', () => {
    const ctx=vm.createContext({});
    vm.runInContext(html.slice(html.indexOf('        function escapeHtml('),html.indexOf('        function getPin(')),ctx);
    vm.runInContext(html.slice(html.indexOf('        function buildPdfReportHtml('),html.indexOf('        // 📄 履歴をPDFファイル')),ctx);
    const out=ctx.buildPdfReportHtml([{date:'9/7',fullDate:'2026-09-07',condition:0,hasStool:false,meds:{},notes:'<script>test</script>'}]);
    assert.match(out,/記録なし/); assert.doesNotMatch(out,/未服用/);
    assert.match(out,/2026-09-07/); assert.doesNotMatch(out,/<script>/);
});
