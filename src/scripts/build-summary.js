// ต้องตรงกับ manualCategoryOrder ใน src/main.js - ใช้จัดลำดับหมวดหมู่ให้เหมือนกัน
// ทุกที่ที่แสดงรายการของสเปคที่บันทึกไว้ (การ์ดสรุปหลังบันทึก, ใบพิมพ์ PDF) เพราะ
// ลำดับที่เก็บในฐานข้อมูล (build_items.id) เรียงตามลำดับที่เพิ่ม/แก้ในตะกร้าล่าสุด
// ไม่ใช่ลำดับหมวดหมู่ที่อ่านง่าย (เช่น เปลี่ยน CPU ทีหลังจะไปโผล่ท้ายตารางถ้าไม่จัดใหม่)
const CATEGORY_ORDER = [
  'cpu',
  'motherboard',
  'video-card',
  'memory',
  'internal-hard-drive',
  'power-supply',
  'case',
  'cpu-cooler'
];

export function createSavedBuildSummary(build = {}) {
  const items = Array.isArray(build.items)
    ? build.items.map(normalizeSummaryItem).sort(compareByCategoryOrder)
    : [];
  const id = Number(build.id || 0);

  return {
    id,
    title: id ? `บันทึกสเปค #${id} แล้ว` : 'บันทึกสเปคแล้ว',
    total: Number(build.total || 0),
    itemCount: items.length,
    items
  };
}

export function createSavedBuildPrintDocument(build = {}) {
  const summary = createSavedBuildSummary(build);
  const title = build.name || summary.title;
  const createdAt = build.createdAt ? new Date(build.createdAt).toLocaleString('th-TH') : new Date().toLocaleString('th-TH');

  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        color: #151515;
        font-family: Arial, Tahoma, sans-serif;
        margin: 0;
        padding: 32px;
      }
      .sheet {
        border: 1px solid #c7dbfb;
        border-radius: 10px;
        margin: 0 auto;
        max-width: 880px;
        overflow: hidden;
      }
      header {
        background: #3b82f6;
        color: #ffffff;
        padding: 24px 28px;
      }
      h1 {
        font-size: 26px;
        margin: 0 0 8px;
      }
      .meta {
        color: #e0ecff;
        font-size: 13px;
      }
      main {
        padding: 24px 28px 28px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th,
      td {
        border-bottom: 1px solid #eeeeee;
        padding: 12px 8px;
        text-align: left;
      }
      th {
        color: #2563eb;
        font-size: 12px;
        text-transform: uppercase;
      }
      td:last-child,
      th:last-child {
        text-align: right;
      }
      .total {
        align-items: center;
        display: flex;
        justify-content: space-between;
        margin-top: 22px;
      }
      .total strong {
        color: #2563eb;
        font-size: 26px;
      }
      @media print {
        body { padding: 0; }
        .sheet { border: 0; border-radius: 0; max-width: none; }
      }
    </style>
  </head>
  <body>
    <section class="sheet">
      <header>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">SpecCraft / ${escapeHtml(createdAt)} / ${summary.itemCount} รายการ</div>
      </header>
      <main>
        <table>
          <thead>
            <tr>
              <th>หมวดหมู่</th>
              <th>สินค้า</th>
              <th>ราคา</th>
            </tr>
          </thead>
          <tbody>
            ${summary.items.map((item) => `
              <tr>
                <td>${escapeHtml(item.category || '-')}</td>
                <td>${escapeHtml(item.name || '-')}${item.quantity > 1 ? ` &times;${item.quantity}` : ''}</td>
                <td>${formatThaiBaht(item.price)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="total">
          <span>ราคารวม</span>
          <strong>${formatThaiBaht(summary.total)}</strong>
        </div>
      </main>
    </section>
    <script>
      window.addEventListener('load', () => {
        window.print();
      });
    </script>
  </body>
</html>`;
}

function normalizeSummaryItem(item) {
  const quantity = Math.max(1, Math.min(2, Math.round(Number(item?.quantity) || 1)));

  return {
    category: item?.category || '',
    name: item?.name || '',
    // ราคาต่อแถวคือราคารวมของแถวนั้น (คูณตาม quantity แล้ว) - ผู้เรียกไม่ต้องคูณเอง
    price: Number(item?.price || 0) * quantity,
    quantity
  };
}

function compareByCategoryOrder(a, b) {
  const indexA = CATEGORY_ORDER.indexOf(a.category);
  const indexB = CATEGORY_ORDER.indexOf(b.category);

  return (indexA === -1 ? CATEGORY_ORDER.length : indexA) - (indexB === -1 ? CATEGORY_ORDER.length : indexB);
}

function formatThaiBaht(value) {
  return `฿${new Intl.NumberFormat('th-TH').format(Number(value || 0))}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
