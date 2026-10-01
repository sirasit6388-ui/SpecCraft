// เฉพาะแรม (memory) เท่านั้นที่เลือกซ้ำสินค้าเดิมได้ 2 ชิ้น (ราคา/ปริมาณคูณ 2) -
// หมวดอื่นยังเลือกได้ทีละ 1 ชิ้นต่อหมวดเหมือนเดิม (quantity เริ่มต้นที่ 1 เสมอ)
export const MAX_CART_ITEM_QUANTITY = 2;

export function addCartItem(items, product) {
  if (!isValidCartItem(product)) {
    return [...items];
  }

  // สินค้าจากหน้ารายการ/ผลจัดสเปคอัตโนมัติไม่มีฟิลด์ quantity ติดมาเลย เลยเริ่มที่ 1
  // เสมอโดยธรรมชาติ (ไม่สืบทอด quantity ของเดิมที่เพิ่งถูกแทนที่มาด้วย) ส่วนตอนคัดลอก
  // สเปคที่แชร์มาใส่ตะกร้า (ผ่าน mergeDuplicateCartItems ก่อน) จะมี quantity ติดมา
  // ด้วยจริง เลยยังคงค่านั้นไว้ตามที่ควร
  return [
    ...items.filter((item) => item.category !== product.category),
    normalizeCartItem(product)
  ];
}

export function removeCartItem(items, category) {
  return items.filter((item) => item.category !== category);
}

// ตั้งจำนวนของสินค้าในหมวดที่ระบุ (ปัจจุบันใช้กับแรมเท่านั้น) ค่าที่ได้จะถูกปัดเป็น
// จำนวนเต็มและจำกัดไว้ระหว่าง 1 ถึง MAX_CART_ITEM_QUANTITY เสมอ
export function setCartItemQuantity(items, category, quantity) {
  const clamped = clampQuantity(quantity);

  return items.map((item) => (
    item.category === category ? { ...item, quantity: clamped } : item
  ));
}

export function calculateCartTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.price || 0) * clampQuantity(item.quantity), 0);
}

export function getCartItemByCategory(items, category) {
  return items.find((item) => item.category === category) || null;
}

export function createSavedBuild(items, savedAt = new Date()) {
  const normalizedItems = items.filter(isValidCartItem).map(normalizeCartItem);

  return {
    savedAt: savedAt.toISOString(),
    total: calculateCartTotal(normalizedItems),
    items: normalizedItems
  };
}

export function hydrateCartItems(value) {
  try {
    const parsed = JSON.parse(value || '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isValidCartItem).map(normalizeCartItem);
  } catch {
    return [];
  }
}

// ส่งตะกร้าไปหลังบ้าน (บันทึก/ซิงก์ build) - หลังบ้านไม่รู้จักคอนเซ็ปต์ quantity
// เลย ยังคงคิดว่า 1 แถว build_items = สินค้า 1 ชิ้นเหมือนเดิมทุกที่ (ดูคอมเมนต์ที่
// setCartItemQuantity ด้านบน) แทนที่จะแก้ schema/query ฝั่งเซิร์ฟเวอร์ทั้งหมด เลย
// "แตกแถว" ที่ quantity > 1 ให้เป็นแถวเดี่ยวๆ ซ้ำกันตามจำนวนก่อนส่งไปแทน ผลรวมราคา/
// จำนวนแถวจึงถูกต้องโดยไม่ต้องแตะฝั่งเซิร์ฟเวอร์เลย
export function expandCartItemsForApi(items) {
  return items.flatMap((item) => {
    const quantity = clampQuantity(item.quantity);
    const { quantity: _drop, ...itemWithoutQuantity } = item;

    return Array.from({ length: quantity }, () => ({ ...itemWithoutQuantity }));
  });
}

// ฝั่งหลังบ้านคืนสเปคที่มีแรมคูณ 2 กลับมาเป็น 2 แถวแยกกัน (คนละแนวคิดกับ quantity -
// ดู expandCartItemsForApi ด้านบน) ใช้อันนี้รวมแถวที่เป็นสินค้าเดียวกันจริงๆ
// (หมวด/ชื่อ/ราคาตรงกัน) กลับเป็นแถวเดียวพร้อม quantity ที่ถูกต้อง ก่อนจะเอาไปแสดงผล
// เป็นตาราง หรือก่อนเอากลับเข้าตะกร้า (setCartItems) เพื่อไม่ให้ตะกร้ามี 2 แถวซ้อนกัน
// ในหมวดเดียวกัน (ผิดกติกาที่ว่า 1 หมวด = 1 แถวในตะกร้า)
export function mergeDuplicateCartItems(items) {
  const merged = [];
  const indexByKey = new Map();

  items.forEach((item) => {
    const key = `${item.category}|${item.name}|${item.price}`;
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...item, quantity: clampQuantity(item.quantity) });
      return;
    }

    merged[existingIndex] = {
      ...merged[existingIndex],
      quantity: clampQuantity((merged[existingIndex].quantity || 1) + (Number(item.quantity) || 1))
    };
  });

  return merged;
}

function isValidCartItem(item) {
  return Boolean(item && item.category && item.name && Number(item.price || 0) >= 0);
}

function clampQuantity(value) {
  const quantity = Math.round(Number(value) || 1);

  return Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, MAX_CART_ITEM_QUANTITY) : 1;
}

function normalizeCartItem(item) {
  // จอ: เก็บฟิลด์ที่ใช้ทำข้อความสรุปใต้ชื่อในตะกร้า (ขนาด/ชนิดแผง/ความละเอียด/รีเฟรชเรต)
  // เพิ่มเฉพาะหมวด monitor เพื่อไม่ให้รูปแบบของหมวดอื่นเปลี่ยนไปจากเดิม
  const monitorSpecs = item.category === 'monitor'
    ? {
        screenSizeInch: item.screenSizeInch ?? null,
        panelType: item.panelType || '',
        resolution: Array.isArray(item.resolution) ? item.resolution.slice(0, 2) : item.resolution || null,
        refreshRate: item.refreshRate ?? null
      }
    : {};

  return {
    id: item.id,
    category: item.category,
    brand: item.brand || '',
    name: item.name,
    price: Number(item.price || 0),
    currency: item.currency || 'THB',
    imageUrl: item.imageUrl || '',
    productUrl: item.productUrl || '',
    socket: item.socket || '',
    formFactor: item.formFactor || '',
    caseType: item.caseType || '',
    memoryType: item.memoryType || '',
    memoryGb: item.memoryGb || null,
    wattage: item.wattage || null,
    quantity: clampQuantity(item.quantity),
    ...monitorSpecs
  };
}
