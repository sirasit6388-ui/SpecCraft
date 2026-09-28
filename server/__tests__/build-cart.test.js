import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addCartItem,
  calculateCartTotal,
  createSavedBuild,
  expandCartItemsForApi,
  getCartItemByCategory,
  hydrateCartItems,
  mergeDuplicateCartItems,
  removeCartItem,
  setCartItemQuantity
} from '../../src/scripts/build-cart.js';

const cpu = { id: 1, category: 'cpu', name: 'Ryzen 5', price: 5000 };
const betterCpu = { id: 2, category: 'cpu', name: 'Ryzen 7', price: 9000 };
const gpu = { id: 3, category: 'video-card', name: 'RTX 4060', price: 12000 };
const ram = { id: 4, category: 'memory', name: 'Kingston Fury 16GB', price: 1500 };

test('addCartItem replaces existing item in the same category', () => {
  const cart = addCartItem([cpu, gpu], betterCpu);

  assert.equal(cart.length, 2);
  assert.equal(cart.find((item) => item.category === 'cpu').name, 'Ryzen 7');
  assert.equal(cart.find((item) => item.category === 'video-card').name, 'RTX 4060');
});

test('removeCartItem removes an item by category', () => {
  const cart = removeCartItem([cpu, gpu], 'cpu');

  assert.deepEqual(cart, [gpu]);
});

test('calculateCartTotal totals numeric product prices', () => {
  assert.equal(calculateCartTotal([cpu, gpu]), 17000);
});

test('getCartItemByCategory returns selected item for a category', () => {
  assert.equal(getCartItemByCategory([cpu, gpu], 'cpu').name, 'Ryzen 5');
  assert.equal(getCartItemByCategory([cpu, gpu], 'memory'), null);
});

test('createSavedBuild stores a build snapshot with timestamp and total', () => {
  const saved = createSavedBuild([cpu, gpu], new Date('2026-06-23T12:00:00.000Z'));

  assert.equal(saved.total, 17000);
  assert.equal(saved.savedAt, '2026-06-23T12:00:00.000Z');
  assert.deepEqual(saved.items.map((item) => item.category), ['cpu', 'video-card']);
});

test('hydrateCartItems ignores invalid saved cart entries', () => {
  const cart = hydrateCartItems(JSON.stringify([cpu, { category: '', price: 10 }, null]));

  assert.equal(cart.length, 1);
  assert.equal(cart[0].category, 'cpu');
  assert.equal(cart[0].name, 'Ryzen 5');
  assert.equal(cart[0].currency, 'THB');
  assert.deepEqual(hydrateCartItems('not json'), []);
});

// เฉพาะแรมเท่านั้นที่เลือกสินค้าเดิมซ้ำได้สูงสุด 2 ชิ้น (ดูคอมเมนต์ที่
// setCartItemQuantity ใน build-cart.js)
test('addCartItem defaults quantity to 1 for a freshly picked product', () => {
  const cart = addCartItem([], ram);

  assert.equal(cart[0].quantity, 1);
});

test('setCartItemQuantity clamps between 1 and MAX_CART_ITEM_QUANTITY (2)', () => {
  const cart = [ram, gpu];

  assert.equal(getCartItemByCategory(setCartItemQuantity(cart, 'memory', 2), 'memory').quantity, 2);
  assert.equal(getCartItemByCategory(setCartItemQuantity(cart, 'memory', 5), 'memory').quantity, 2);
  assert.equal(getCartItemByCategory(setCartItemQuantity(cart, 'memory', 0), 'memory').quantity, 1);
  assert.equal(getCartItemByCategory(setCartItemQuantity(cart, 'memory', -3), 'memory').quantity, 1);
  // หมวดอื่นไม่ถูกแตะต้อง (ไม่มีฟิลด์ quantity ติดมาเลย เท่ากับ 1 โดยปริยาย)
  assert.equal(getCartItemByCategory(setCartItemQuantity(cart, 'memory', 2), 'video-card').quantity, undefined);
});

test('calculateCartTotal multiplies price by quantity', () => {
  const cart = setCartItemQuantity([ram, gpu], 'memory', 2);

  assert.equal(calculateCartTotal(cart), 1500 * 2 + 12000);
});

test('expandCartItemsForApi duplicates a quantity-2 item into 2 single rows without a quantity field', () => {
  const cart = setCartItemQuantity([ram, gpu], 'memory', 2);
  const expanded = expandCartItemsForApi(cart);

  assert.equal(expanded.length, 3);
  const memoryRows = expanded.filter((item) => item.category === 'memory');
  assert.equal(memoryRows.length, 2);
  assert.deepEqual(memoryRows[0], memoryRows[1]);
  assert.equal('quantity' in memoryRows[0], false);
  // จำนวนแถวรวมกันคูณราคาต้องเท่ากับ calculateCartTotal ของตะกร้าเดิม (ผลรวมราคาตรงกัน)
  assert.equal(expanded.reduce((sum, item) => sum + item.price, 0), calculateCartTotal(cart));
});

test('mergeDuplicateCartItems merges rows with the same category/name/price back into one with the right quantity', () => {
  const expanded = expandCartItemsForApi(setCartItemQuantity([ram, gpu], 'memory', 2));
  const merged = mergeDuplicateCartItems(expanded);

  assert.equal(merged.length, 2);
  assert.equal(getCartItemByCategory(merged, 'memory').quantity, 2);
  assert.equal(getCartItemByCategory(merged, 'video-card').quantity, 1);
});

test('mergeDuplicateCartItems leaves an already-merged (quantity-tagged) cart unchanged', () => {
  const cart = setCartItemQuantity([ram, gpu], 'memory', 2);
  const merged = mergeDuplicateCartItems(cart);

  assert.equal(merged.length, 2);
  assert.equal(getCartItemByCategory(merged, 'memory').quantity, 2);
});
