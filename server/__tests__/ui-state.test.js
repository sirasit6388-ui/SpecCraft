import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEmptyState, createLoadingState } from '../../src/scripts/ui-state.js';

test('createLoadingState renders skeleton loading markup', () => {
  const html = createLoadingState('กำลังโหลดสินค้า...', 3);

  assert.match(html, /loading-state/);
  assert.match(html, /skeleton-line/);
  assert.match(html, /กำลังโหลดสินค้า/);
  assert.equal((html.match(/class="skeleton-line/g) || []).length, 3);
});

test('createEmptyState renders intentional empty state markup', () => {
  const html = createEmptyState({
    title: 'ไม่พบสินค้า',
    message: 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง'
  });

  assert.match(html, /empty-state/);
  assert.match(html, /ไม่พบสินค้า/);
  assert.match(html, /ลองเปลี่ยนคำค้นหา/);
});
