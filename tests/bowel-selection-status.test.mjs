import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');

function createContext() {
  const elements = {
    bowelSelectionStatus: { textContent: '' },
    bowelConfirmedNone: { checked: false },
    stoolDifficult: { checked: false },
  };
  const amountButtons = Array.from({ length: 3 }, () => ({
    classList: { add() {}, remove() {} },
  }));
  const context = vm.createContext({
    document: {
      getElementById: (id) => elements[id],
      querySelectorAll: (selector) => selector === '.amount-btn' ? amountButtons : [],
    },
  });
  const start = html.indexOf('        function updateBowelSelectionStatus()');
  const end = html.indexOf('        function updateLastStoolDisplay(', start);
  vm.runInContext(`let selectedAmountValue = '';\n${html.slice(start, end)}`, context);
  return { context, elements, amountButtons };
}

test('排便の選択状態は保存時の意味をその場で示す', () => {
  const { context, elements, amountButtons } = createContext();

  context.updateBowelSelectionStatus();
  assert.equal(elements.bowelSelectionStatus.textContent, '今の選択：未確認のまま保存します');

  elements.bowelConfirmedNone.checked = true;
  context.selectNoStool(true);
  assert.equal(elements.bowelSelectionStatus.textContent, '今の選択：排便なしを確認済みとして保存します');

  context.selectAmount('小 (S)', amountButtons[0]);
  assert.equal(elements.bowelConfirmedNone.checked, false);
  assert.equal(elements.bowelSelectionStatus.textContent, '今の選択：便あり（小 (S)）として保存します');

  context.clearBowelSelection();
  assert.equal(elements.bowelSelectionStatus.textContent, '今の選択：未確認のまま保存します');
});
