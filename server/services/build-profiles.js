// สัดส่วนงบของโหมด "รวมจอ" สำหรับระบบจัดสเปคอัตโนมัติ
// วิธีคิด: เอาสัดส่วนเดิมของระบบ (CPU/การ์ดจอ 50% แบ่ง 60/40 เล่นเกม หรือ 50/50 ทำงาน, หมวดมาตรฐาน 8% x 5,
// ชุดระบายความร้อน 3%) มาย่อทุกหมวดลงด้วยอัตราส่วนเท่ากัน (x (93-8)/93) เพื่อเปิดที่ว่างให้จอ 8%
// สัดส่วนระหว่างหมวดเดิมจึงเหมือนเดิมทุกประการ (เช่น เล่นเกม CPU ยังเป็น 1.5 เท่าของการ์ดจอ) มีแค่จอเป็นหมวดใหม่
//
// กรณีไม่รวมจอไม่ใช้ไฟล์นี้เลย ใช้สัดส่วนเดิมของ builder.service.js ตรงๆ (30/20/8x5/3 เล่นเกม, 25/25/8x5/3 ทำงาน)
//
// เป็นข้อมูลล้วน ไม่ต่อฐานข้อมูล

export const MONITOR_SHARE = 0.08; // 8% ของงบรวม เท่ากันทั้งสองโหมด
const SCALE = 1 - MONITOR_SHARE / 0.93; // ย่อหมวดเดิมลงเพื่อเปิดที่ว่าง 8% จากก้อน 93% เดิม

// สัดส่วนหมวดเดิม (ก่อนย่อ) ตรงกับค่าคงที่ในไฟล์ builder.service.js (STANDARD_CATEGORY_SHARE = 0.08, COOLER_SHARE = 0.03,
// CPU+การ์ดจอ = 0.5 ของงบ แบ่ง 0.6/0.4 เล่นเกม หรือ 0.5/0.5 ทำงาน) คัดลอกมาไว้ที่นี่เพื่อคำนวณสัดส่วนจอแยกเป็นฟังก์ชันล้วน
const BASE_SHARES = {
  gaming: { cpu: 0.5 * 0.6, 'video-card': 0.5 * 0.4, motherboard: 0.08, memory: 0.08, 'internal-hard-drive': 0.08, 'power-supply': 0.08, case: 0.08, 'cpu-cooler': 0.03 },
  work: { cpu: 0.5 * 0.5, 'video-card': 0.5 * 0.5, motherboard: 0.08, memory: 0.08, 'internal-hard-drive': 0.08, 'power-supply': 0.08, case: 0.08, 'cpu-cooler': 0.03 }
};

export function normalizeMonitorMode(mode) {
  return mode === 'gaming' ? 'gaming' : 'work';
}

// เป้าหมาย (บาท) ของแต่ละหมวดเมื่อรวมจอ: หมวดเดิมทุกหมวด x SCALE บวกจอ = MONITOR_SHARE x งบ
export function calculateMonitorBudgetPlan(mode, budget) {
  const normalizedMode = normalizeMonitorMode(mode);
  const total = Math.max(0, Math.round(Number(budget) || 0));
  const targets = {};

  for (const [category, share] of Object.entries(BASE_SHARES[normalizedMode])) {
    targets[category] = Math.round(total * share * SCALE);
  }

  targets.monitor = Math.round(total * MONITOR_SHARE);

  return { mode: normalizedMode, budget: total, targets };
}
