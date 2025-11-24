// ===========================================
// 🔧 CONFIG
// ===========================================
const API_BASE = "https://script.google.com/macros/s/AKfycbzreWtci5acYFMCtYiMULj33YJVQXqyh41ziXkprhrDJ1Rj_uxM8Wvu7qI-y6FweWGx/exec"; 


let currentPOId = null;
window.isEditing = false;        // ⭐ ใช้เช็คว่าเป็นโหมดแก้ไข
window.originalInvoiceNo = null; // ⭐ เก็บเลข PO เดิมตอนเข้าแก้

function toThaiDate(dateStr) {
  if (!dateStr) return "";

  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");

  // เพิ่มปี 543 ให้เป็น พ.ศ.
  const year = d.getFullYear() + 543;

  return `${day}/${month}/${year}`;
}

function formatNumber(n) {
  if (n === null || n === undefined || n === "") return "0.00";
  return Number(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function thaiBaht(amount) {
  let num = Math.floor(amount);
  if (num === 0) return "ศูนย์บาทถ้วน";

  const t = ["ศูนย์","หนึ่ง","สอง","สาม","สี่","ห้า","หก","เจ็ด","แปด","เก้า"];
  const u = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

  let s = "";
  let digits = num.toString();
  let len = digits.length;

  for (let i = 0; i < len; i++) {
    let d = parseInt(digits[i]);
    let pos = len - i - 1; // 0 = หน่วย

    if (d === 0) continue;

    // หลักหน่วย
    if (pos === 0) {
      if (d === 1 && len > 1) s += "หนึ่ง";
      else s += t[d];
    }

    // หลักสิบ
    else if (pos === 1) {
      if (d === 1) s += "สิบ";
      else if (d === 2) s += "ยี่สิบ";
      else s += t[d] + "สิบ";
    }

    // หลักร้อยขึ้นไป
    else {
      if (d === 1) s += "หนึ่ง";
      else s += t[d];
    }

    s += u[pos];
  }

  return s + "บาทถ้วน";
}

// ===========================================
// 🌐 GAS HELPERS
// ===========================================
async function gasGet(route, params = {}) {
  const qs = new URLSearchParams({ route, ...params });
  const res = await fetch(`${API_BASE}?${qs.toString()}`);
  return res.json();
}

async function gasPost(route, data = {}) {
  const form = new FormData();
  form.append("route", route);
  form.append("payload", JSON.stringify(data));
  const res = await fetch(API_BASE, {
    method: "POST",
    body: form,
  });
  return res.json();
}

// ===========================================
// 🧩 INITIAL
// ===========================================
document.addEventListener("DOMContentLoaded", () => {
  checkSession();
  addItemRow();
  loadVendorList();

  const toggleBtn = document.getElementById("togglePassword");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const pwd = document.getElementById("password");
      const icon = document.getElementById("toggleIcon");
      if (!pwd) return;
      if (pwd.type === "password") {
        pwd.type = "text";
        icon?.classList.remove("bi-eye");
        icon?.classList.add("bi-eye-slash");
      } else {
        pwd.type = "password";
        icon?.classList.remove("bi-eye-slash");
        icon?.classList.add("bi-eye");
      }
    });
  }

  // ⭐⭐⭐ อันนี้คือตำแหน่งที่ถูกต้อง ⭐⭐⭐
  const sup = document.getElementById("supplierName");
  if (sup) {
    sup.addEventListener("change", autoFillVendor);
  }
});

async function loadVendorList() {
  try {
    const res = await gasGet("getVendors"); // ดึงรายการผู้ขายทั้งหมด
    if (!res.success) return;

    const vendorList = document.getElementById("vendorList");
    vendorList.innerHTML = "";

    res.data.forEach(v => {
      vendorList.innerHTML += `<option value="${v.supplierName}"></option>`;
    });

  } catch (err) {
    console.error("loadVendorList error:", err);
  }
}

async function autoFillVendor() {
  const supplierName = document.getElementById("supplierName").value.trim();
  if (!supplierName) return;

  try {
    const res = await gasGet("getVendorInfo", { supplierName });

    if (res.success) {
      const v = res.data;

      document.getElementById("taxID").value = v.taxID || "";
      document.getElementById("phone").value = v.phone || "";
      document.getElementById("address").value = v.address || "";
      document.getElementById("credit").value = v.credit || "";
      document.getElementById("attn").value = v.attn || "";

      lockVendorFields(true);
    } else {
      lockVendorFields(false);
    }
  } catch (err) {
    console.error("Auto vendor error:", err);
  }
}

function lockVendorFields(lock) {
  const fields = ["taxID", "phone", "address", "credit", "attn"];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.readOnly = lock;
      el.style.background = lock ? "#f0f0f0" : "white";
    }
  });
}


function checkSession() {
  const username = localStorage.getItem("username");
  const expireTime = localStorage.getItem("expireTime");
  const role = localStorage.getItem("role");

  if (!username || !expireTime) return showLogin();

  if (Date.now() > Number(expireTime)) {
    Swal.fire("หมดเวลาใช้งาน", "กรุณาเข้าสู่ระบบใหม่อีกครั้ง", "info").then(() => {
      localStorage.clear();
      showLogin();
    });
    return;
  }

  hideLogin();
  applyRoleUI(role);
  showSection("dashboard");
  loadPOs();
  loadRecentPOs();
}

// ===========================================
// 🔐 LOGIN / LOGOUT
// ===========================================
async function login(e) {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const data = await gasPost("login", { username, password });

    if (data.success) {
      localStorage.setItem("username", data.username);
      localStorage.setItem("role", data.role);
      localStorage.setItem("expireTime", Date.now() + 60 * 60 * 1000);

      hideLogin();
      applyRoleUI(data.role);
      showSection("dashboard");
      loadPOs();
      loadRecentPOs();

      Swal.fire({
        title: "เข้าสู่ระบบสำเร็จ",
        text: `ยินดีต้อนรับ ${data.name}`,
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
    } else {
      Swal.fire("ผิดพลาด", data.message || "เข้าสู่ระบบไม่สำเร็จ", "error");
    }
  } catch (err) {
    console.error(err);
    Swal.fire("ผิดพลาด", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
  }
}

function hideLogin() {
  const login = document.getElementById("login-section");
  const app = document.getElementById("app-section");
  if (login && app) {
    login.style.setProperty("display", "none", "important");
    app.style.setProperty("display", "block", "important");
  }
}

function showLogin() {
  const login = document.getElementById("login-section");
  const app = document.getElementById("app-section");
  if (login && app) {
    login.style.setProperty("display", "flex", "important");
    app.style.setProperty("display", "none", "important");
  }
}

function logout() {
  Swal.fire({
    title: "ออกจากระบบ?",
    text: "คุณต้องการออกจากระบบหรือไม่?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "ออกจากระบบ",
    cancelButtonText: "ยกเลิก",
  }).then(res => {
    if (res.isConfirmed) {
      localStorage.clear();
      showLogin();
    }
  });
}

// ===========================================
// 👤 ROLE CONTROL
// ===========================================
function applyRoleUI(role) {
  const approveNav = document.getElementById("nav-approve");
  const backupNav = document.getElementById("nav-backup");

  // ตอนนี้ให้เห็นหมดก่อน
  approveNav?.classList.remove("d-none");
  backupNav?.classList.remove("d-none");
}

// ===========================================
// 🧭 NAVIGATION
// ===========================================
function showSection(sectionId, el) {
  document.querySelectorAll(".content-section").forEach(sec => {
    sec.classList.remove("active");
    sec.style.display = "none";
  });

  const section = document.getElementById(`${sectionId}-section`);
  if (section) {
    section.style.display = "block";
    section.classList.add("active");
  }

  document.querySelectorAll(".nav-link").forEach(link =>
    link.classList.remove("active")
  );
  if (el) el.classList.add("active");

  switch (sectionId) {
    case "dashboard":
      loadPOs();
      loadRecentPOs();
      break;
    case "create":
      if (!window.isEditing) newPONumber();
      break;
    case "approve":
      loadApprovalList();
      break;
    case "history":
      loadPOs();
      break;
    case "backup":
      refreshDBInfo();
      break;
  }
}

// ===========================================
// 📄 CREATE PO
// ===========================================
async function newPONumber() {
  try {
    const data = await gasGet("newPONumber");
    if (data.success) {
      document.getElementById("invoiceNo").value = data.invoiceNo;
    }
  } catch (e) {
    console.error("สร้างเลข PO ไม่ได้:", e);
  }
}

function addItemRow() {
  const tbody = document.getElementById("items-tbody");
  const rowCount = tbody.rows.length + 1;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="text-center" style="width: 5%;">${rowCount}</td>
    <td style="width: 40%;"><input type="text" class="form-control form-control-sm" placeholder="ชื่อสินค้า"></td>
    <td style="width: 5%;"><input type="number" class="form-control form-control-sm text-end" onchange="calculateTotal()"></td>
    <td style="width: 10%;"><input type="number" class="form-control form-control-sm text-end" onchange="calculateTotal()"></td>
    <td style="width: 10%;"><input type="text" class="form-control form-control-sm" placeholder="หน่วย"></td>
    <td style="width: 5%;"><input type="number" class="form-control form-control-sm text-end" onchange="calculateTotal()"></td>
    <td class="total text-end" style="width: 10%;">0.00</td>
    <td class="text-center" style="width: 5%;"><button class="btn btn-danger btn-sm" onclick="removeItemRow(this)"><i class="bi bi-trash"></i></button></td>`;
  tbody.appendChild(tr);
  calculateTotal();
}

function removeItemRow(btn) {
  btn.closest("tr").remove();
  updateItemIndex();
  calculateTotal();
}

function updateItemIndex() {
  document.querySelectorAll("#items-tbody tr").forEach((tr, i) => {
    tr.querySelector("td:first-child").innerText = i + 1;
  });
}

function clearForm() {
  document.getElementById("po-form").reset();
  document.getElementById("items-tbody").innerHTML = "";
  document.getElementById("subtotal").innerText = "0.00";
  document.getElementById("vat-amount").innerText = "0.00";
  document.getElementById("final-total").innerText = "0.00";
  document.getElementById("subtotal-thaibaht").innerText = "ศูนย์บาทถ้วน";

  // ⭐ รีเซ็ตโหมดแก้ไข
  window.isEditing = false;
  window.originalInvoiceNo = null;

  // ⭐ คืนค่า invoiceNo ให้แก้ได้เหมือนเดิม
  const invoiceField = document.getElementById("invoiceNo");
  invoiceField.readOnly = false;
  invoiceField.style.background = "white";

  newPONumber();
  addItemRow();
}


// ===========================================
// 💰 CALCULATION
// ===========================================
function calculateTotal() {
  let subtotal = 0;
  document.querySelectorAll("#items-tbody tr").forEach(tr => {
    const inputs = tr.querySelectorAll("input");
    const qty = parseFloat(inputs[1].value) || 0;
    const price = parseFloat(inputs[2].value) || 0;
    const discount = parseFloat(inputs[4].value) || 0;
    const total = qty * price - discount;
    tr.querySelector(".total").innerText = total.toFixed(2);
    subtotal += total;
  });

  const extraDiscount = parseFloat(document.getElementById("extraDiscount")?.value) || 0;
  const vatCheck = document.getElementById("vat-check")?.checked;
  const customVat = parseFloat(document.getElementById("customVat")?.value) || 0;

  let vat = 0;
  if (vatCheck) {
    vat = subtotal * 0.07;
  } else if (customVat > 0) {
    vat = customVat > 100 ? customVat : subtotal * (customVat / 100);
  }

  const finalTotal = subtotal - extraDiscount + vat;

  document.getElementById("subtotal").innerText = subtotal.toFixed(2);
  document.getElementById("total-discount").innerText = extraDiscount.toFixed(2);
  document.getElementById("vat-amount").innerText = vat.toFixed(2);
  document.getElementById("final-total").innerText = finalTotal.toFixed(2);
  document.getElementById("subtotal-thaibaht").innerText = thaiBaht(finalTotal);
}


// ===========================================
// 💾 SAVE / LOAD
// ===========================================
async function savePurchaseOrder() {
  const items = Array.from(document.querySelectorAll("#items-tbody tr")).map(tr => {
    const inputs = tr.querySelectorAll("input");
    return {
      product: inputs[0].value,
      qty: parseFloat(inputs[1].value) || 0,
      price: parseFloat(inputs[2].value) || 0,
      unit: inputs[3].value,
      discount: parseFloat(inputs[4].value) || 0,
      total: parseFloat(tr.querySelector(".total").innerText) || 0,
    };
  });

const poData = {
  invoiceNo: document.getElementById("invoiceNo").value,
  poDate: document.getElementById("poDate").value,
  supplierName: document.getElementById("supplierName").value,
  taxID: document.getElementById("taxID").value,
  phone: document.getElementById("phone").value,
  address: document.getElementById("address").value,
  credit: document.getElementById("credit").value,
  attn: document.getElementById("attn").value,
  referNote: document.getElementById("referNote").value,
  remark: document.getElementById("remark").value,
  subtotal: parseFloat(document.getElementById("subtotal").innerText),
  discount: parseFloat(document.getElementById("total-discount").innerText),
  vat: parseFloat(document.getElementById("vat-amount").innerText),
  finalTotal: parseFloat(document.getElementById("final-total").innerText),
  createdBy: localStorage.getItem("username"),
  status: "ร่าง",
  items,
  // ⭐ เพิ่มสองอันนี้
  isEdit: !!window.isEditing,
  originalInvoiceNo: window.originalInvoiceNo || document.getElementById("invoiceNo").value,
};


  Swal.fire({ title: "กำลังบันทึก...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const result = await gasPost("savePO", poData);
    Swal.close();

    if (result.success) {
      Swal.fire("สำเร็จ", "บันทึกข้อมูลเรียบร้อย", "success");
      loadPOs();
      loadRecentPOs();
      clearForm();
    } else {
      Swal.fire("ผิดพลาด", result.message || "ไม่สามารถบันทึกข้อมูลได้", "error");
    }
  } catch (err) {
    console.error(err);
    Swal.fire("ผิดพลาด", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
  }
}

// ===========================================
// 📊 LOAD DATA / DASHBOARD
// ===========================================
async function loadPOs() {
    const tbody = document.getElementById("po-history-tbody");
  tbody.innerHTML = `
    <tr><td colspan="7" class="text-center py-4 text-secondary">
      <div class="spinner-border text-primary" role="status"></div>
      <div class="mt-2">กำลังโหลดข้อมูล</div>
    </td></tr>`;
  try {
    const result = await gasGet("getPOs");
    const tbody = document.getElementById("po-history-tbody");
    tbody.innerHTML = "";

    if (!result.success || !result.data?.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">ไม่มีข้อมูล</td></tr>`;
      return;
    }

    result.data.forEach(po => {
      let statusColor = "secondary";
      if (po.status === "ร่าง") statusColor = "warning";
      else if (po.status === "อนุมัติ") statusColor = "success";
      else if (po.status === "ยกเลิก") statusColor = "danger";

      tbody.innerHTML += `
        <tr>
          <td>${po.invoiceNo}</td>
          <td>${toThaiDate(po.poDate)}</td>
          <td>${po.supplierName}</td>
          <td class="text-end">${Number(po.finalTotal || 0).toLocaleString()}</td>
          <td class="text-center"><span class="badge bg-${statusColor}">${po.status}</span></td>
          <td class="text-center">${po.createdBy}</td>
          <td class="text-center">
            <button class="btn btn-info btn-sm rounded-circle" data-id="${po.invoiceNo}" onclick="showDetail(this.dataset.id)">
              <i class="fa-solid fa-eye"></i>
            </button>
          </td>
        </tr>`;
    });

    updateDashboardStats(result.data);
  } catch (err) {
    console.error(err);
    document.getElementById("po-history-tbody").innerHTML =
      `<tr><td colspan="7" class="text-danger text-center">เชื่อมต่อ API ไม่ได้</td></tr>`;
  }
}

async function loadRecentPOs() {
  const tbody = document.getElementById("recent-po-tbody");
  tbody.innerHTML = `
    <tr><td colspan="6" class="text-center py-4 text-secondary">
      <div class="spinner-border text-primary" role="status"></div>
      <div class="mt-2">กำลังโหลดข้อมูล</div>
    </td></tr>`;
  try {
    const result = await gasGet("getPOs");
    const recent = result.data?.slice(-5).reverse() || [];

    tbody.innerHTML = recent.map(po => {
      let statusColor = "secondary";
      if (po.status === "ร่าง") statusColor = "warning";
      else if (po.status === "อนุมัติ") statusColor = "success";
      else if (po.status === "ยกเลิก") statusColor = "danger";

      return `
        <tr>
          <td>${po.invoiceNo}</td>
          <td>${toThaiDate(po.poDate)}</td>
          <td>${po.supplierName}</td>
          <td class="text-end">${Number(po.finalTotal || 0).toLocaleString()}</td>
          <td class="text-center"><span class="badge bg-${statusColor}">${po.status}</span></td>
        </tr>`;
    }).join("");

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center">เชื่อมต่อ API ไม่ได้</td></tr>`;
  }
}

function updateDashboardStats(data) {
  const total = data.length;
  const draft = data.filter(p => p.status === "ร่าง").length;
  const approved = data.filter(p => p.status === "อนุมัติ").length;
  const totalAmount = data.reduce((s, p) => s + (parseFloat(p.finalTotal) || 0), 0);

  document.getElementById("total-pos").innerText = total;
  document.getElementById("draft-pos").innerText = draft;
  document.getElementById("approved-pos").innerText = approved;
  document.getElementById("total-amount").innerText =
    totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

// ===========================================
// ✅ APPROVAL SECTION
// ===========================================
async function loadApprovalList() {
  const tbody = document.getElementById("approve-tbody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr><td colspan="6" class="text-center py-4 text-secondary">
      <div class="spinner-border text-primary" role="status"></div>
      <div class="mt-2">กำลังโหลดข้อมูล</div>
    </td></tr>`;

  try {
    const result = await gasGet("getPOs");
    if (!result.success) throw new Error("โหลดข้อมูลไม่สำเร็จ");

    const pending = result.data?.filter(po =>
      (po.status || "").trim().toLowerCase() === "ร่าง"
    ) || [];

    tbody.innerHTML = "";

    if (pending.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="6" class="text-center text-muted py-3">
          <i class="bi bi-inbox me-2"></i> ไม่มีใบสั่งซื้อที่รออนุมัติ
        </td></tr>`;
      return;
    }

    pending.forEach(po => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${po.invoiceNo}</td>
        <td>${toThaiDate(po.poDate)}</td>
        <td>${po.supplierName}</td>
        <td class="text-end">${Number(po.finalTotal || 0).toLocaleString()}</td>
        <td class="text-center"><span class="badge bg-secondary">${po.status}</span></td>
        <td class="text-center">
          <button class="btn btn-success btn-sm me-1" onclick="updateStatus('${po.invoiceNo}','อนุมัติ')">
            <i class="bi bi-check-circle"></i> อนุมัติ
          </button>
          <button class="btn btn-danger btn-sm" onclick="updateStatus('${po.invoiceNo}','ยกเลิก')">
            <i class="bi bi-x-circle"></i> ยกเลิก
          </button>
        </td>`;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error("loadApprovalList error:", err);
    Swal.fire("ผิดพลาด", "โหลดข้อมูลไม่สำเร็จ", "error");
  }
}

async function updateStatus(invoiceNo, newStatus) {
  Swal.fire({
    title: "ยืนยันการเปลี่ยนสถานะ?",
    text: `ต้องการเปลี่ยนใบสั่งซื้อ ${invoiceNo} เป็น "${newStatus}" หรือไม่?`,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "ยืนยัน",
    cancelButtonText: "ยกเลิก",
  }).then(async (res) => {
    if (!res.isConfirmed) return;

    Swal.fire({
      title: "กำลังอัปเดต...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const data = await gasPost("updateStatus", { invoiceNo, newStatus });
      Swal.close();

      if (data.success) {
        Swal.fire("สำเร็จ", data.message, "success");
        loadApprovalList();
        loadPOs();
      } else {
        Swal.fire("ผิดพลาด", data.message || "ไม่สามารถอัปเดตได้", "error");
      }
    } catch (err) {
      console.error("updateStatus error:", err);
      Swal.fire("ผิดพลาด", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
    }
  });
}

// ===========================================
// 🧰 BACKUP / DB INFO
// ===========================================
async function exportBackup() {
  try {
    const res = await fetch(`${API_BASE}?route=backup`);
    const text = await res.text();
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "db.json";
    a.click();
  } catch (err) {
    console.error(err);
    Swal.fire("ผิดพลาด", "ไม่สามารถสำรองข้อมูลได้", "error");
  }
}

async function refreshDBInfo() {
  try {
    const info = await gasGet("dbInfo");
    if (!info.success) throw new Error();

    document.getElementById("db-po-count").innerText = info.poCount;
    document.getElementById("db-item-count").innerText = info.itemCount;
    document.getElementById("db-version").innerText = info.version;
    document.getElementById("db-connection-status").innerText = info.status;
  } catch (err) {
    console.error(err);
    document.getElementById("db-connection-status").innerText = "ERROR";
  }
}

function clearAllData() {
  Swal.fire({
    title: "ล้างข้อมูลทั้งหมด?",
    text: "การกระทำนี้ไม่สามารถกู้คืนได้",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "ยืนยันล้างข้อมูล",
    cancelButtonText: "ยกเลิก",
  }).then(async (r) => {
    if (!r.isConfirmed) return;
    try {
      const res = await gasPost("clearDB", {});
      if (res.success) {
        Swal.fire("สำเร็จ", "ลบข้อมูลทั้งหมดเรียบร้อย", "success");
        refreshDBInfo();
        loadPOs();
        loadRecentPOs();
      } else {
        Swal.fire("ผิดพลาด", res.message || "ล้างข้อมูลไม่สำเร็จ", "error");
      }
    } catch (err) {
      console.error(err);
      Swal.fire("ผิดพลาด", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
    }
  });
}

// stub สำหรับปุ่มใน backup section (ป้องกัน error console)
function importBackup() {
  Swal.fire("ยังไม่รองรับ", "ฟังก์ชันนำเข้า db.json ยังไม่ได้พัฒนา", "info");
}
function loadSampleData() {
  Swal.fire("ยังไม่รองรับ", "ฟังก์ชันโหลดข้อมูลตัวอย่างยังไม่ได้พัฒนา", "info");
}

// ===========================================
// 🧾 DETAIL & PRINT
// ===========================================
async function showDetail(invoiceNo) {
  // 🎉 แสดง Popup กำลังโหลด
Swal.fire({
  title: "กำลังโหลดข้อมูล...",
  html: "I will close in <b></b> milliseconds.",
  timer: 2000,
  timerProgressBar: true,
  didOpen: () => {
    Swal.showLoading();
    const timer = Swal.getPopup().querySelector("b");
    timerInterval = setInterval(() => {
      timer.textContent = `${Swal.getTimerLeft()}`;
    }, 100);
  },
  willClose: () => {
    clearInterval(timerInterval);
  }
}).then((result) => {
  if (result.dismiss === Swal.DismissReason.timer) {
    console.log("I was closed by the timer");
  }
});

  try {
    const result = await gasGet("getPO", { invoiceNo });

    // ปิด Loading เมื่อโหลดเสร็จ
    Swal.close();

    if (!result.success) {
      return Swal.fire("ผิดพลาด", "ไม่พบข้อมูล", "error");
    }

    const po = result.data;
    currentPOId = po.invoiceNo;

const items = po.items || [];
const maxRows = 15;

// สร้างแถวรายการจริง
const itemsHtml = [...items].map((i, idx) => `
  <tr>
    <td class="text-center" style="width: 5%; color:${i.product ? 'black' : 'white'};">
      ${i.product ? idx + 1 : ""}
    </td>
    <td style="width: 45%;">${i.product || ""}</td>
    <td class="text-center" style="width: 8%;">${i.qty ? Number(i.qty).toFixed(0) : ""}</td>
    <td class="text-center" style="width: 5%;">${i.unit || ""}</td>
    <td class="text-end" style="width: 12%;">${i.price ? formatNumber(i.price) : ""}</td>
    <td class="text-end" style="width: 10%;">${(i.discount || i.discount === 0) ? formatNumber(i.discount) : ""}</td>
    <td class="text-end" style="width: 15%;">${i.total ? formatNumber(i.total) : ""}</td>
  </tr>
`).join("");


// ✅ สร้างแถวว่างสำหรับ Print
let emptyRows = "";
for (let i = items.length + 1; i <= maxRows; i++) {
  emptyRows += `
    <tr class="print-fill-rows">
      <td style="color:white;">${i}</td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  `;
}


    document.getElementById("print-content").innerHTML = `
      <div class="company-header d-flex">
        <div style="flex: 0 0 65%; display:flex; align-items:flex-start; gap:5px;">
          <div class="d-flex mt-3">
            <img src="./imgs/logoTH.png" style="width:120px; height:auto; object-fit:contain;">
          </div>
          <div >
            <h4>บริษัท เจริญไชยสุรินทร์คลังเหล็ก จำกัด</h4>
            <p>
              276/1 ถ.ปัทมานนท์ ต.ในเมือง อ.เมือง จ.สุรินทร์ 32000<br>
              TEL: (044) 512-251 FAX: (044) 519-788<br>
              เลขประจำตัวผู้เสียภาษี 0325536000176
            </p>
          </div>
        </div>
        <div style="flex: 0 0 35%; text-align:center;">
          <h4 style="margin-top: 80px;">ใบสั่งซื้อ/ORDER</h4>
        </div>
      </div>

      <div class="po-details d-flex mt-1">
        <div style="flex: 0 0 75%;">
          <p>
            ผู้จำหน่าย : ${po.supplierName}<br>
            ${po.address}<br>
            โทร : ${po.phone}<br>
            เลขประจำตัวผู้เสียภาษี : ${po.taxID}
          </p>
        </div>
        <div style="flex: 0 0 25%;">
          <p>
            เลขที่: ${po.invoiceNo}<br>
            วันที่: ${toThaiDate(po.poDate)}<br>
            เครดิต: ${po.credit || "0"} วัน
          </p>
        </div>
      </div>

      <table style="width:100%; margin-top:4px;">
        <tr>
          <td style="text-align:left;">ATTN : ${po.attn || "ไม่ระบุ"}</td>
          <td style="text-align:right;">อ้างอิง: ${po.referNote || "ไม่ระบุ"}</td>
        </tr>
      </table>

      <table class="table table-bordered mb-0">
        <thead class="table-dark">
          <tr>
            <th class="text-center">ลำดับ</th>
            <th class="text-center">รายการสินค้า</th>
            <th class="text-center">จำนวน</th>
            <th class="text-center">หน่วย</th>
            <th class="text-center">ราคา/หน่วย</th>
            <th class="text-center">ส่วนลด</th>
            <th class="text-center">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody
        ${itemsHtml}
        ${emptyRows}
        </tbody>
      </table>

<table style="
  width:100%;
  border: 1px solid #d1d1d1; 
  border-top: none;           
  border-collapse: collapse;
">
  <tr>
<td colspan="3" rowspan="4"
    style="
      width:70%;
      padding:4px;
      position:relative;
      height:120px;
    ">

  <!-- หมายเหตุ -->
  <div>
    หมายเหตุ: ${po.remark || " "}
  </div>

  <!-- ⭐ จำนวนเงินไทย ชิดขอบล่าง โดยไม่ดันตารางขวา ⭐ -->
  <div style="
      position:absolute;
      bottom:4px;
      left:0;
      width:100%;
      text-align:center;
      font-weight:bold;
    ">
    (${thaiBaht(po.finalTotal)})
  </div>

</td>


    <td style="width:30%; padding:4px;">รวมเป็นเงิน:</td>
    <td colspan="2" class="text-end" style="width:35%; padding:4px;">
      ${formatNumber(po.subtotal)}
    </td>
  </tr>

  <tr style="height: 6px;">
    <td style="padding:4px;">ส่วนลด:</td>
    <td colspan="2" class="text-end" style="padding:4px;">
      ${formatNumber(po.discount)}
    </td>
  </tr>

  <tr style="height: 6px;">
    <td style="padding:4px;">จำนวนภาษีมูลค่าเพิ่ม 7%:</td>
    <td colspan="2" class="text-end" style="padding:4px;">
      ${formatNumber(po.vat)}
    </td>
  </tr>

  <tr style="height: 6px;">
    <td style="padding:4px;"><strong>จำนวนเงินทั้งสิ้น:</strong></td>
    <td colspan="2" class="text-end" style="padding:4px;">
      <strong>${formatNumber(po.finalTotal)}</strong>
    </td>
  </tr>
</table>

<div style="
  width:100%;
  height:1px;
  background:#d1d1d1;
  margin-top:20px;
  margin-bottom:10px;
"></div>

<table style="width:100%; text-align:center; margin-top:10px;">
  <tr>

    <td style="width:50%;"></td>

    <td style="width:50%; text-align:center;">
      ในนาม บริษัท เจริญไชยสุรินทร์คลังเหล็ก จำกัด
    </td>
  </tr>

    <td style="padding-top:50px;">
      ..........................................................................................<br>
      ผู้สั่งซื้อ
    </td>

    <td style="padding-top:50px;">
      ..........................................................................................<br>
      ผู้อนุมัติ
    </td>
  </tr>
</table>

    `;

    showSection("detail");

  } catch (err) {
    Swal.close();
    console.error(err);
    Swal.fire("ผิดพลาด", "ไม่สามารถโหลดรายละเอียดได้", "error");
  }
}


async function editPurchaseOrder(invoiceNo) {
  try {
    const result = await gasGet("getPO", { invoiceNo });

    if (!result.success) {
      Swal.fire("ผิดพลาด", "ไม่พบข้อมูลใบสั่งซื้อ", "error");
      return;
    }

    const po = result.data;

    document.getElementById("invoiceNo").value = po.invoiceNo;
    document.getElementById("poDate").value = po.poDate;
    document.getElementById("supplierName").value = po.supplierName;
    document.getElementById("taxID").value = po.taxID;
    document.getElementById("phone").value = po.phone;
    document.getElementById("address").value = po.address;
    document.getElementById("credit").value = po.credit;
    document.getElementById("attn").value = po.attn;
    document.getElementById("referNote").value = po.referNote;
    document.getElementById("remark").value = po.remark;

    // 🔒 ไม่ให้แก้เลขที่เอกสาร (แล้วแต่ต้องการ)
    const invoiceField = document.getElementById("invoiceNo");
    invoiceField.readOnly = true;
    invoiceField.style.background = "#e9ecef";

    // ⭐ ตั้งโหมดเป็นแก้ไข + เก็บเลข PO เดิม
    window.isEditing = true;
    window.originalInvoiceNo = po.invoiceNo;

    const tbody = document.getElementById("items-tbody");
    tbody.innerHTML = "";

    (po.items || []).forEach(i => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td><input type="text" class="form-control form-control-sm" value="${i.product}"></td>
        <td><input type="number" class="form-control form-control-sm text-end" value="${i.qty}" onchange="calculateTotal()"></td>
        <td><input type="number" class="form-control form-control-sm text-end" value="${i.price}" onchange="calculateTotal()"></td>
        <td><input type="text" class="form-control form-control-sm" value="${i.unit}"></td>
        <td><input type="number" class="form-control form-control-sm text-end" value="${i.discount}" onchange="calculateTotal()"></td>
        <td class="total text-end">${i.total}</td>
        <td class="text-center">
          <button class="btn btn-danger btn-sm" onclick="removeItemRow(this)">
            <i class="bi bi-trash"></i>
          </button>
        </td>`;
      tbody.appendChild(tr);
    });

    updateItemIndex();
    calculateTotal();
    showSection("create");
  } catch (err) {
    console.error(err);
    Swal.fire("ผิดพลาด", "ไม่สามารถโหลดข้อมูล PO สำหรับแก้ไขได้", "error");
  }
}


function printPurchaseOrder() {
  window.print();
}

function openVendorModal() {
  const modal = new bootstrap.Modal(document.getElementById("vendorModal"));
  modal.show();
}

async function saveVendor() {
  const vendor = {
    supplierName: document.getElementById("v_name").value.trim(),
    taxID: document.getElementById("v_tax").value.trim(),
    phone: document.getElementById("v_phone").value.trim(),
    address: document.getElementById("v_address").value.trim(),
    credit: document.getElementById("v_credit").value.trim(),
    attn: document.getElementById("v_attn").value.trim()
  };

  if (!vendor.supplierName) {
    Swal.fire("กรุณากรอกชื่อผู้ขาย", "", "warning");
    return;
  }

  Swal.fire({ title: "กำลังบันทึก...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const res = await gasPost("saveVendor", vendor);
    Swal.close();

    if (res.success) {
      Swal.fire("สำเร็จ", res.message, "success");

      // โหลด vendor list ใหม่
      loadVendorList();

      // ปิด Modal
      bootstrap.Modal.getInstance(document.getElementById("vendorModal")).hide();
    } else {
      Swal.fire("ผิดพลาด", res.message, "error");
    }

  } catch (err) {
    Swal.fire("ผิดพลาด", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
  }
}

function loadPurchaseOrders() {

  loadPOs();  // โหลดตารางทั้งหมด
  loadRecentPOs(); // โหลดรายการล่าสุด

  setTimeout(() => Swal.close(), 800);
}

function filterPurchaseOrders() {
  const keyword = document.getElementById("search-input").value.toLowerCase();
  const status = document.getElementById("status-filter").value;
  const dateFrom = document.getElementById("date-from").value;
  const dateTo = document.getElementById("date-to").value;

  const rows = document.querySelectorAll("#po-history-tbody tr");

  rows.forEach(row => {
    const cols = row.querySelectorAll("td");

    const poNo = cols[0]?.innerText.toLowerCase();
    const poDate = cols[1]?.innerText;         // dd/mm/yyyy (after convert)
    const supplier = cols[2]?.innerText.toLowerCase();
    const poStatus = cols[4]?.innerText.trim();

    let show = true;

    // 🔍 keyword match (PO, supplier)
    if (keyword && !(poNo.includes(keyword) || supplier.includes(keyword))) {
      show = false;
    }

    // 🎯 status filter
    if (status && poStatus !== status) {
      show = false;
    }

    // 📅 date filter
    if (dateFrom) {
      const [d,m,y] = poDate.split("/");
      const poTime = new Date(`${y}-${m}-${d}`).getTime();
      const fromTime = new Date(dateFrom).getTime();
      if (poTime < fromTime) show = false;
    }

    if (dateTo) {
      const [d,m,y] = poDate.split("/");
      const poTime = new Date(`${y}-${m}-${d}`).getTime();
      const toTime = new Date(dateTo).getTime();
      if (poTime > toTime) show = false;
    }

    row.style.display = show ? "" : "none";
  });
}
