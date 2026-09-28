import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSavedBuildPrintDocument, createSavedBuildSummary } from '../../src/scripts/build-summary.js';

test('createSavedBuildSummary prepares saved build display data', () => {
  const summary = createSavedBuildSummary({
    id: 9,
    total: 30000,
    items: [
      { category: 'cpu', name: 'Ryzen 7', price: 12000 },
      { category: 'video-card', name: 'RTX 4060', price: 18000 }
    ]
  });

  assert.equal(summary.title, 'บันทึกสเปค #9 แล้ว');
  assert.equal(summary.total, 30000);
  assert.equal(summary.itemCount, 2);
  assert.deepEqual(summary.items.map((item) => item.name), ['Ryzen 7', 'RTX 4060']);
});

test('createSavedBuildSummary sorts items by category order, not insertion order', () => {
  const summary = createSavedBuildSummary({
    id: 9,
    total: 30000,
    items: [
      { category: 'video-card', name: 'RTX 4060', price: 18000 },
      { category: 'cpu', name: 'Ryzen 7', price: 12000 }
    ]
  });

  assert.deepEqual(summary.items.map((item) => item.category), ['cpu', 'video-card']);
});

test('createSavedBuildSummary handles missing build values safely', () => {
  const summary = createSavedBuildSummary({});

  assert.equal(summary.title, 'บันทึกสเปคแล้ว');
  assert.equal(summary.total, 0);
  assert.equal(summary.itemCount, 0);
  assert.deepEqual(summary.items, []);
});

// แรม 2 ชิ้น (quantity: 2) - ราคาต่อแถวต้องเป็นราคารวม (คูณแล้ว) และมีคำต่อท้าย
// "×2" ต่อชื่อสินค้า ให้เห็นชัดว่าแถวนี้คือ 2 ชิ้น ไม่ใช่ชิ้นเดียวราคาแพงขึ้น
test('createSavedBuildSummary multiplies price by quantity and reports it back', () => {
  const summary = createSavedBuildSummary({
    id: 9,
    total: 15000,
    items: [
      { category: 'memory', name: 'Kingston Fury 16GB', price: 1500, quantity: 2 },
      { category: 'cpu', name: 'Ryzen 7', price: 12000 }
    ]
  });

  const memoryItem = summary.items.find((item) => item.category === 'memory');
  assert.equal(memoryItem.price, 3000);
  assert.equal(memoryItem.quantity, 2);

  const cpuItem = summary.items.find((item) => item.category === 'cpu');
  assert.equal(cpuItem.price, 12000);
  assert.equal(cpuItem.quantity, 1);
});

test('createSavedBuildPrintDocument shows a x2 suffix and the multiplied price for a quantity-2 row', () => {
  const html = createSavedBuildPrintDocument({
    id: 12,
    name: 'Gaming Build',
    total: 15000,
    items: [
      { category: 'memory', name: 'Kingston Fury 16GB', price: 1500, quantity: 2 },
      { category: 'cpu', name: 'Ryzen 7', price: 12000 }
    ]
  });

  assert.match(html, /Kingston Fury 16GB &times;2/);
  assert.match(html, /฿3,000/);
});

test('createSavedBuildPrintDocument creates a printable spec document', () => {
  const html = createSavedBuildPrintDocument({
    id: 12,
    name: 'Gaming Build',
    total: 49995,
    items: [
      { category: 'cpu', name: 'AMD Ryzen 7 7800X3D', price: 12412 },
      { category: 'video-card', name: 'RTX 4070', price: 21900 }
    ]
  });

  assert.match(html, /<!doctype html>/);
  assert.match(html, /Gaming Build/);
  assert.match(html, /AMD Ryzen 7 7800X3D/);
  assert.match(html, /RTX 4070/);
  assert.match(html, /฿49,995/);
  assert.match(html, /window\.print/);
});
