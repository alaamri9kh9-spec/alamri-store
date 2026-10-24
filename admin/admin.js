/* =====================================================================
   لوحة التحكم — تعمل على GitHub Pages بدون أي سيرفر
   - الدخول باسم مستخدم وكلمة مرور
   - مفتاح GitHub محفوظ مشفّراً (AES-256) في data/admin.json ولا يُفك إلا بكلمة المرور الصحيحة
   - كل حفظ = تحديث ملف data/store.json في المستودع، ويظهر على الموقع خلال دقيقة تقريباً
   ===================================================================== */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $("#app");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const utf8ToB64 = s => { const bytes = enc.encode(s); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64ToUtf8 = s => dec.decode(unb64(s.replace(/\s/g, "")));
  const ITER = 600000;
  const SS = { get: k => { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del: k => { try { sessionStorage.removeItem(k); } catch (e) {} } };

  /* ---------- Crypto ---------- */
  async function keyFrom(user, pass, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(user.trim().toLowerCase() + "\n" + pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealToken(user, pass, token, repo, branch) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(user, pass, salt), enc.encode(token));
    return { v: 1, repo, branch, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function openToken(conf, user, pass) {
    const k = await keyFrom(user, pass, unb64(conf.salt));
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(conf.iv) }, k, unb64(conf.ct)));
  }

  /* ---------- GitHub API ---------- */
  let S = SS.get("agri-admin");        // {token, repo, branch, user}
  async function gh(path, opts = {}, auth = S) {
    const r = await fetch(`https://api.github.com/repos/${auth.repo}${path}`, {
      ...opts, cache: "no-store",
      headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) }
    });
    if (r.status === 401) throw new Error("مفتاح GitHub غير صالح أو انتهت صلاحيته. حدّثه من شاشة الدخول ← «إعداد / تحديث مفتاح GitHub».");
    if (r.status === 403) throw new Error("المفتاح لا يملك صلاحية الكتابة على المستودع (Contents: Read and write).");
    if (r.status === 404 && opts.method !== "GET" && opts.method) throw new Error("لم يتم العثور على المستودع. تأكد من اسم المستودع.");
    if (!r.ok && r.status !== 404) throw new Error("خطأ من GitHub (" + r.status + "). حاول مرة أخرى.");
    if (r.status === 404) return null;
    return r.status === 204 ? {} : r.json();
  }
  const getFile = async (path, auth) => gh(`/contents/${encodeURI(path)}?ref=${(auth || S).branch}&t=${Date.now()}`, {}, auth);
  async function putFile(path, contentB64, message, sha, auth = S) {
    const body = { message, content: contentB64, branch: auth.branch };
    if (sha) body.sha = sha;
    return gh(`/contents/${encodeURI(path)}`, { method: "PUT", body: JSON.stringify(body) }, auth);
  }
  async function deleteFile(path) {
    try { const f = await getFile(path); if (f?.sha) await gh(`/contents/${encodeURI(path)}`, { method: "DELETE", body: JSON.stringify({ message: "حذف صورة", sha: f.sha, branch: S.branch }) }); } catch (e) { /* not critical */ }
  }

  /* ---------- State ---------- */
  let DATA = null, SHA = null, view = "products", editId = null;
  const CUR = () => DATA.settings.currency || "ر.ع";
  const money = n => Number(n || 0).toFixed(3) + " " + CUR();
  const newId = p => p + Math.random().toString(36).slice(2, 10);
  const imgUrl = p => !p ? "" : /^https?:|^data:/.test(p) ? p : "../" + p;

  async function loadData() {
    const f = await getFile("data/store.json");
    if (!f) throw new Error("لم يتم العثور على data/store.json في المستودع.");
    SHA = f.sha; DATA = JSON.parse(b64ToUtf8(f.content));
    DATA.settings ||= {}; DATA.categories ||= []; DATA.products ||= [];
  }
  async function save(msg) {
    busy(true);
    try {
      let res;
      try { res = await putFile("data/store.json", utf8ToB64(JSON.stringify(DATA, null, 1)), msg, SHA); }
      catch (e) {       // file changed elsewhere (e.g. another device) → refresh sha once and retry
        const f = await getFile("data/store.json"); SHA = f?.sha;
        res = await putFile("data/store.json", utf8ToB64(JSON.stringify(DATA, null, 1)), msg, SHA);
      }
      SHA = res.content.sha;
      flash("✓ تم الحفظ — سيظهر على الموقع خلال دقيقة تقريباً");
      return true;
    } catch (e) { flash(e.message, true); return false; }
    finally { busy(false); }
  }
  function busy(v) { $("#saving").classList.toggle("show", v); $$("button").forEach(b => b.disabled = v); }
  let flashMsg = null;
  function flash(msg, err) { flashMsg = [msg, err]; const el = $("#flash"); if (el) { el.className = "flash" + (err ? " err" : ""); el.textContent = msg; el.hidden = false; clearTimeout(el._t); if (!err) el._t = setTimeout(() => el.hidden = true, 5000); window.scrollTo({ top: 0, behavior: "smooth" }); } }

  /* ---------- Image: resize & compress in the browser, then upload to repo ---------- */
  async function uploadImage(file) {
    if (!file) return null;
    if (!file.type.startsWith("image/")) throw new Error("الملف ليس صورة.");
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
    let blob = file, ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    if (bmp) {
      const max = 1200, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      blob = await new Promise(r => c.toBlob(r, "image/webp", 0.82));
      ext = "webp";
      if (!blob || blob.type !== "image/webp") { blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85)); ext = "jpg"; }
    }
    const buf = new Uint8Array(await blob.arrayBuffer()); let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const path = `images/uploads/${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    await putFile(path, btoa(bin), "رفع صورة");
    return path;
  }
  function stillUsed(path) { return DATA.products.some(p => p.img === path) || DATA.categories.some(c => c.img === path); }
  async function dropImage(path) { if (path && path.startsWith("images/uploads/") && !stillUsed(path)) await deleteFile(path); }

  /* =================== Screens =================== */
  function authScreen(mode, err) {
    const isSetup = mode === "setup";
    const guess = (() => { const h = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0]; if (h.endsWith(".github.io")) { const o = h.split(".")[0]; return seg && seg !== "admin" ? `${o}/${seg}` : `${o}/${h}`; } return ""; })();
    app.innerHTML = `
      <div class="auth"><form class="card auth-box" id="auth">
        <div class="logo">🌿</div>
        <h1>${isSetup ? "إعداد لوحة التحكم" : "تسجيل الدخول"}</h1>
        <p class="muted">${isSetup ? "مرة واحدة فقط: اختر اسم مستخدم وكلمة مرور، والصق مفتاح GitHub." : "أدخل اسم المستخدم وكلمة المرور."}</p>
        ${err ? `<div class="flash err">${esc(err)}</div>` : ""}
        <label>اسم المستخدم<input name="user" required autocomplete="username" value="${isSetup ? "mohammad" : ""}"></label>
        <label>كلمة المرور<input name="pass" type="password" required autocomplete="${isSetup ? "new-password" : "current-password"}" ${isSetup ? 'minlength="10"' : ""}></label>
        ${isSetup ? `
          <label>تأكيد كلمة المرور<input name="pass2" type="password" required minlength="10" autocomplete="new-password"></label>
          <label>مفتاح GitHub (Token)<input name="token" required placeholder="github_pat_..." autocomplete="off" spellcheck="false" dir="ltr"></label>
          <label>اسم المستودع<input name="repo" required value="${esc(guess)}" placeholder="username/repo" dir="ltr"></label>
          <label>الفرع (Branch)<input name="branch" required value="main" dir="ltr"></label>` : ""}
        <button class="btn big block">${isSetup ? "حفظ الإعداد والدخول" : "دخول"}</button>
        <a class="muted back" href="#" id="switch">${isSetup ? "← رجوع لتسجيل الدخول" : "إعداد / تحديث مفتاح GitHub"}</a>
        <a class="muted back" href="../">← العودة للموقع</a>
      </form></div>`;
    $("#switch").onclick = e => { e.preventDefault(); authScreen(isSetup ? "login" : "setup"); };
    $("#auth").onsubmit = async e => {
      e.preventDefault(); const f = e.target, btn = f.querySelector("button");
      btn.disabled = true; btn.textContent = "⏳ لحظة...";
      try { isSetup ? await doSetup(f) : await doLogin(f); }
      catch (er) { authScreen(mode, er.message); }
    };
  }

  async function doSetup(f) {
    const user = f.user.value.trim(), pass = f.pass.value, token = f.token.value.trim(), repo = f.repo.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, ""), branch = f.branch.value.trim();
    if (pass !== f.pass2.value) throw new Error("كلمتا المرور غير متطابقتين.");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("اسم المستودع يجب أن يكون بالشكل: username/repo");
    const auth = { token, repo, branch, user };
    const info = await gh("", {}, auth);
    if (!info) throw new Error("لم يتم العثور على المستودع أو المفتاح لا يملك صلاحية عليه.");
    if (info.permissions && !info.permissions.push) throw new Error("المفتاح لا يملك صلاحية الكتابة. اختر Contents: Read and write.");
    const conf = await sealToken(user, pass, token, repo, branch);
    const old = await getFile("data/admin.json", auth);
    await putFile("data/admin.json", utf8ToB64(JSON.stringify(conf, null, 1)), "إعداد لوحة التحكم", old?.sha, auth);
    S = auth; SS.set("agri-admin", S); await start("✓ تم الإعداد بنجاح. احفظ اسم المستخدم وكلمة المرور في مكان آمن.");
  }

  async function doLogin(f) {
    const conf = await fetch("../data/admin.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!conf) { authScreen("setup", "لم يتم إعداد لوحة التحكم بعد (أو ما زال الإعداد ينشر — انتظر دقيقة)."); return; }
    let token;
    try { token = await openToken(conf, f.user.value, f.pass.value); }
    catch (e) { await new Promise(r => setTimeout(r, 800)); throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة."); }
    S = { token, repo: conf.repo, branch: conf.branch || "main", user: f.user.value.trim() };
    SS.set("agri-admin", S); await start();
  }

  async function start(msg) {
    app.innerHTML = `<div class="auth"><div class="card auth-box"><div class="logo">🌿</div><p class="muted">جارٍ تحميل البيانات...</p></div></div>`;
    try { await loadData(); }
    catch (e) { SS.del("agri-admin"); S = null; authScreen("login", e.message); return; }
    if (msg) flashMsg = [msg, false];
    render();
  }

  /* ---------- Layout ---------- */
  function render() {
    const nav = [["products", "📦 المنتجات"], ["categories", "🗂️ الأقسام"], ["settings", "⚙️ الإعدادات"]];
    app.innerHTML = `
      <header class="top">
        <a class="brand" href="#">🌿 <span><b>${esc(DATA.settings.name)}</b><small>لوحة التحكم</small></span></a>
        <nav>${nav.map(([k, t]) => `<a href="#" data-nav="${k}" class="${view === k || (k === "products" && view === "edit") ? "active" : ""}">${t}</a>`).join("")}
          <a href="../" target="_blank">🌐 الموقع</a><a href="#" id="logout">خروج</a></nav>
      </header>
      <main class="wrap"><div id="flash" class="flash" hidden></div><div id="view"></div></main>`;
    $$("[data-nav]").forEach(a => a.onclick = e => { e.preventDefault(); view = a.dataset.nav; render(); });
    $("#logout").onclick = e => { e.preventDefault(); SS.del("agri-admin"); S = null; DATA = null; authScreen("login"); };
    ({ products: vProducts, edit: vEdit, categories: vCategories, settings: vSettings })[view]();
    if (flashMsg) { flash(...flashMsg); flashMsg = null; }
  }
  const catName = id => DATA.categories.find(c => c.id === id)?.name || "بدون قسم";

  /* ---------- Products ---------- */
  function vProducts() {
    const list = DATA.products.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const avail = list.filter(p => p.available !== false).length;
    $("#view").innerHTML = `
      <div class="stats">
        <div class="stat"><b>${list.length}</b><span>منتج</span></div><div class="stat"><b>${avail}</b><span>متوفر</span></div>
        <div class="stat"><b>${list.length - avail}</b><span>غير متوفر</span></div><div class="stat"><b>${DATA.categories.length}</b><span>قسم</span></div>
      </div>
      <div class="bar"><h1>المنتجات</h1><div class="bar-actions"><input type="search" id="q" placeholder="🔍 ابحث عن منتج..."><button class="btn" id="add">+ إضافة منتج</button></div></div>
      ${list.length ? "" : `<div class="empty">لا توجد منتجات بعد. اضغط «إضافة منتج» للبدء 🌱</div>`}
      <div class="plist">${list.map(p => `
        <div class="pitem ${p.available === false ? "off" : ""}" data-name="${esc(p.name)}">
          <div class="thumb">${p.img ? `<img src="${esc(imgUrl(p.img))}" alt="" loading="lazy" onerror="this.remove()">` : ""}🌱</div>
          <div class="pinfo"><b>${esc(p.name)}</b><small>${esc(catName(p.cat))}${p.badge ? " · " + esc(p.badge) : ""}</small>
            <span class="pprice">${money(p.price)}${p.old_price > p.price ? ` <s>${money(p.old_price)}</s>` : ""}</span></div>
          <div class="pact">
            <button class="pill ${p.available !== false ? "on" : ""}" data-t="available" data-id="${p.id}">${p.available !== false ? "● متوفر" : "○ غير متوفر"}</button>
            <button class="pill star ${p.featured ? "on" : ""}" data-t="featured" data-id="${p.id}">${p.featured ? "★" : "☆"} بالرئيسية</button>
            <button class="btn sm light" data-edit="${p.id}">تعديل</button>
            <button class="btn sm light" data-dup="${p.id}">نسخ</button>
            <button class="btn sm danger" data-del="${p.id}">حذف</button>
          </div>
        </div>`).join("")}</div>`;
    $("#q").oninput = e => { const t = e.target.value.trim(); $$(".pitem").forEach(r => r.style.display = !t || r.dataset.name.includes(t) ? "" : "none"); };
    $("#add").onclick = () => { editId = null; view = "edit"; render(); };
    $("#view").onclick = async e => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      const p = DATA.products.find(x => x.id === (b.dataset.id || b.dataset.edit || b.dataset.dup || b.dataset.del));
      if (b.dataset.t) { const k = b.dataset.t; p[k] = k === "available" ? p.available === false : !p.featured; if (await save(`تحديث ${p.name}`)) vProducts(); }
      else if (b.dataset.edit) { editId = p.id; view = "edit"; render(); }
      else if (b.dataset.dup) { DATA.products.push({ ...p, id: newId("p"), name: p.name + " (نسخة)", created: Math.floor(Date.now() / 1000), order: DATA.products.length + 1 }); if (await save(`نسخ ${p.name}`)) vProducts(); }
      else if (b.dataset.del && confirm(`حذف «${p.name}» نهائياً؟`)) { DATA.products = DATA.products.filter(x => x !== p); if (await save(`حذف ${p.name}`)) { await dropImage(p.img); vProducts(); } }
    };
  }

  function vEdit() {
    const p = DATA.products.find(x => x.id === editId) || { id: "", name: "", cat: DATA.categories[0]?.id || "", price: "", old_price: 0, desc: "", img: "", badge: "", available: true, featured: false, order: DATA.products.length + 1 };
    const fmt = n => n === "" || n == null ? "" : Number(n).toFixed(3);
    $("#view").innerHTML = `
      <div class="bar"><h1>${p.id ? "تعديل منتج" : "إضافة منتج جديد"}</h1><button class="btn light" id="back">→ رجوع</button></div>
      <form class="card form" id="pf">
        <div class="grid2"><div>
          <label>اسم المنتج *<input name="name" required value="${esc(p.name)}" placeholder="مثال: بذور الطماطم"></label>
          <label>القسم<select name="cat">${DATA.categories.map(c => `<option value="${esc(c.id)}" ${c.id === p.cat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <div class="grid2 tight">
            <label>السعر (${esc(CUR())}) *<input name="price" required inputmode="decimal" value="${fmt(p.price)}" placeholder="0.800"></label>
            <label>السعر قبل الخصم <small>(اختياري)</small><input name="old_price" inputmode="decimal" value="${p.old_price ? fmt(p.old_price) : ""}" placeholder="1.000"></label>
          </div>
          <label>الوصف <small>(اختياري — طريقة الزراعة، الموسم، الكمية...)</small><textarea name="desc" rows="4">${esc(p.desc)}</textarea></label>
          <label>شارة على الصورة <small>(اختياري)</small><input name="badge" list="badges" value="${esc(p.badge)}" placeholder="مثال: جديد">
            <datalist id="badges"><option>جديد</option><option>الأكثر طلباً</option><option>عرض خاص</option><option>مميز</option><option>كمية محدودة</option><option>موسمي</option></datalist></label>
          <div class="checks">
            <label class="check"><input type="checkbox" name="available" ${p.available !== false ? "checked" : ""}> متوفر للطلب</label>
            <label class="check"><input type="checkbox" name="featured" ${p.featured ? "checked" : ""}> إظهاره في الصفحة الرئيسية</label>
          </div>
          <label>ترتيب الظهور <small>(الرقم الأصغر يظهر أولاً)</small><input type="number" name="order" value="${p.order ?? 0}" style="max-width:140px"></label>
        </div><div>
          <label>صورة المنتج</label>
          <label class="drop"><img id="preview" src="${esc(imgUrl(p.img))}" ${p.img ? "" : "hidden"} alt="">
            <span id="drop-txt" ${p.img ? "hidden" : ""}>📷<br>اضغط لاختيار صورة<br><small>من الجوال أو الكمبيوتر — تُضغط تلقائياً</small></span>
            <input type="file" name="image" accept="image/*" id="file" hidden></label>
          ${p.img ? `<label class="check"><input type="checkbox" name="remove_image"> إزالة الصورة الحالية</label>` : ""}
        </div></div>
        <div class="form-foot"><button class="btn big">💾 حفظ المنتج</button><button type="button" class="btn light" id="cancel">إلغاء</button></div>
      </form>`;
    const back = () => { view = "products"; render(); };
    $("#back").onclick = back; $("#cancel").onclick = back;
    $("#file").onchange = () => { const f = $("#file").files[0]; if (f) { $("#preview").src = URL.createObjectURL(f); $("#preview").hidden = false; $("#drop-txt").hidden = true; } };
    $("#pf").onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      const price = parseFloat(f.price.value.replace(",", "."));
      if (!f.name.value.trim() || isNaN(price) || price < 0) return flash("تأكد من الاسم والسعر.", true);
      busy(true);
      try {
        const oldImg = p.img;
        let img = p.img;
        const file = f.image.files[0];
        if (file) img = await uploadImage(file); else if (f.remove_image?.checked) img = "";
        const prod = { ...p, id: p.id || newId("p"), created: p.created || Math.floor(Date.now() / 1000),
          name: f.name.value.trim(), cat: f.cat.value, price: +price.toFixed(3), old_price: +(parseFloat(f.old_price.value.replace(",", ".")) || 0).toFixed(3),
          desc: f.desc.value.trim(), badge: f.badge.value.trim(), available: f.available.checked, featured: f.featured.checked, order: parseInt(f.order.value) || 0, img };
        const i = DATA.products.findIndex(x => x.id === prod.id);
        if (i >= 0) DATA.products[i] = prod; else DATA.products.push(prod);
        busy(false);
        if (await save(`${i >= 0 ? "تعديل" : "إضافة"} ${prod.name}`)) { if (oldImg !== img) await dropImage(oldImg); view = "products"; flashMsg = [i >= 0 ? "✓ تم حفظ التعديلات — تظهر على الموقع خلال دقيقة" : "✓ تمت إضافة المنتج — يظهر على الموقع خلال دقيقة", false]; render(); }
      } catch (er) { busy(false); flash(er.message, true); }
    };
  }

  /* ---------- Categories ---------- */
  function vCategories() {
    const rows = [...DATA.categories, { id: "", name: "", sub: "", img: "" }];
    $("#view").innerHTML = `<div class="bar"><h1>الأقسام</h1></div><div class="cats">${rows.map(c => {
      const n = c.id ? DATA.products.filter(p => p.cat === c.id).length : 0;
      return `<form class="card cat ${c.id ? "" : "new"}" data-id="${esc(c.id)}">
        <h3>${c.id ? esc(c.name) + ` <small>(${n} منتج)</small>` : "+ قسم جديد"}</h3>
        ${c.img ? `<img src="${esc(imgUrl(c.img))}" class="cat-img" alt="" onerror="this.remove()">` : ""}
        <label>اسم القسم<input name="name" required value="${esc(c.name)}"></label>
        <label>وصف قصير<input name="sub" value="${esc(c.sub)}"></label>
        <label>صورة القسم<input type="file" name="image" accept="image/*"></label>
        <div class="row"><button class="btn sm">${c.id ? "حفظ" : "إضافة القسم"}</button>${c.id ? `<button type="button" class="btn sm danger" data-delcat="${esc(c.id)}">حذف</button>` : ""}</div>
      </form>`; }).join("")}</div>`;
    $$("form.cat").forEach(f => f.onsubmit = async e => {
      e.preventDefault(); busy(true);
      try {
        const id = f.dataset.id, file = f.image.files[0];
        const img = file ? await uploadImage(file) : null;
        let c = DATA.categories.find(x => x.id === id), old = c?.img;
        if (!c) { c = { id: newId("c"), name: "", sub: "", img: "" }; DATA.categories.push(c); }
        c.name = f.name.value.trim(); c.sub = f.sub.value.trim(); if (img) c.img = img;
        busy(false);
        if (await save(`${id ? "تعديل" : "إضافة"} قسم ${c.name}`)) { if (img && old) await dropImage(old); flashMsg = ["✓ تم حفظ القسم", false]; render(); }
      } catch (er) { busy(false); flash(er.message, true); }
    });
    $$("[data-delcat]").forEach(b => b.onclick = async () => {
      const id = b.dataset.delcat, n = DATA.products.filter(p => p.cat === id).length;
      if (n) return flash(`لا يمكن حذف القسم لأن فيه ${n} منتج. انقل المنتجات لقسم آخر أولاً.`, true);
      if (!confirm("حذف القسم؟")) return;
      const c = DATA.categories.find(x => x.id === id); DATA.categories = DATA.categories.filter(x => x.id !== id);
      if (await save(`حذف قسم ${c.name}`)) { await dropImage(c.img); flashMsg = ["تم حذف القسم", false]; render(); }
    });
  }

  /* ---------- Settings ---------- */
  function vSettings() {
    const s = DATA.settings;
    const f = (k, label, ph = "", hint = "") => `<label>${label}${hint ? ` <small>${hint}</small>` : ""}<input name="${k}" value="${esc(s[k])}" placeholder="${esc(ph)}"></label>`;
    const t = (k, label, rows = 2, hint = "") => `<label>${label}${hint ? ` <small>${hint}</small>` : ""}<textarea name="${k}" rows="${rows}">${esc(s[k])}</textarea></label>`;
    $("#view").innerHTML = `
      <div class="bar"><h1>إعدادات الموقع</h1><a class="btn light" href="../" target="_blank">معاينة الموقع ↗</a></div>
      <form class="card form" id="sf">
        <h3>المعلومات الأساسية</h3>
        <div class="grid2">${f("name", "اسم المتجر")}${f("tagline", "الوصف المختصر تحت الاسم")}
          ${f("whatsapp", "رقم الواتساب لاستقبال الطلبات", "93669592", "(يكفي الرقم العُماني من 8 أرقام)")}${f("followers", "عدد المتابعين (صفحة عنّي)", "31K+")}</div>
        <h3>شريط الإعلان أعلى الموقع</h3>${f("announcement", "نص الإعلان", "مثال: خصم 10% على بذور الخضروات", "(اتركه فارغاً لإخفاء الشريط)")}
        <h3>الصفحة الرئيسية</h3><div class="grid2">${f("hero_title", "العنوان الرئيسي")}${f("hero_title2", "السطر الثاني الملوّن")}</div>
        ${t("hero_text", "النص التعريفي")}${t("delivery_note", "ملاحظة التوصيل والدفع", 2, "(تظهر في سلة المشتريات)")}${t("about_text", "نص صفحة «عنّي»", 3)}
        <h3>حسابات التواصل الاجتماعي <small>(الرابط كامل — اتركه فارغاً لإخفائه)</small></h3>
        <div class="grid2">${f("instagram", "Instagram", "https://instagram.com/...")}${f("tiktok", "TikTok", "https://tiktok.com/@...")}${f("facebook", "Facebook", "https://facebook.com/...")}${f("threads", "Threads", "https://threads.net/@...")}</div>
        <div class="form-foot"><button class="btn big">💾 حفظ الإعدادات</button></div>
      </form>
      <form class="card form" id="pw" style="max-width:520px">
        <h3>🔒 تغيير اسم المستخدم أو كلمة المرور</h3>
        <label>اسم المستخدم الجديد<input name="user" required value="${esc(S.user)}"></label>
        <label>كلمة المرور الجديدة<input type="password" name="pass" required minlength="10" autocomplete="new-password"></label>
        <label>تأكيد كلمة المرور<input type="password" name="pass2" required minlength="10" autocomplete="new-password"></label>
        <button class="btn">تغيير</button>
        <p class="muted" style="margin-top:10px;font-size:14px">💡 كل تعديل يُحفظ في سجل GitHub، فيمكن الرجوع لأي نسخة سابقة عند الحاجة.</p>
      </form>`;
    $("#sf").onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target);
      for (const [k, v] of fd) s[k] = String(v).trim();
      let wa = s.whatsapp.replace(/\D/g, ""); if (wa.startsWith("00")) wa = wa.slice(2); if (wa.length === 8) wa = "968" + wa; s.whatsapp = wa;
      if (await save("تحديث الإعدادات")) { flashMsg = ["✓ تم حفظ الإعدادات — تظهر على الموقع خلال دقيقة", false]; render(); }
    };
    $("#pw").onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      if (f.pass.value !== f.pass2.value) return flash("كلمتا المرور غير متطابقتين.", true);
      busy(true);
      try {
        const conf = await sealToken(f.user.value.trim(), f.pass.value, S.token, S.repo, S.branch);
        const old = await getFile("data/admin.json");
        await putFile("data/admin.json", utf8ToB64(JSON.stringify(conf, null, 1)), "تغيير كلمة المرور", old?.sha);
        S.user = f.user.value.trim(); SS.set("agri-admin", S);
        busy(false); flashMsg = ["✓ تم التغيير. استخدم البيانات الجديدة في الدخول القادم (بعد دقيقة).", false]; render();
      } catch (er) { busy(false); flash(er.message, true); }
    };
  }

  /* ---------- Boot ---------- */
  if (!window.crypto?.subtle) { app.innerHTML = `<div class="auth"><div class="card auth-box"><h1>المتصفح غير مدعوم</h1><p class="muted">افتح لوحة التحكم عبر رابط https في متصفح حديث.</p></div></div>`; return; }
  if (S?.token) start();
  else fetch("../data/admin.json?t=" + Date.now(), { cache: "no-store" }).then(r => authScreen(r.ok ? "login" : "setup")).catch(() => authScreen("setup"));
})();
