/* واجهة المتجر — تقرأ المنتجات والإعدادات من data/store.json (يتم تعديلها من لوحة التحكم /admin) */
(async function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const page = document.body.dataset.page || "home";

  /* skeletons while loading */
  $$("[data-skeleton]").forEach(el => el.innerHTML = '<div class="skeleton"></div>'.repeat(+el.dataset.skeleton));

  let DATA;
  try { DATA = await fetch("data/store.json?v=" + Date.now()).then(r => r.json()); }
  catch (e) { DATA = { settings: {}, categories: [], products: [] }; console.error("store.json", e); }
  const S = DATA.settings || {};
  const CUR = S.currency || "ر.ع";
  const CATS = DATA.categories || [];
  const PRODUCTS = (DATA.products || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const catOf = id => CATS.find(c => c.id === id);
  const byId = id => PRODUCTS.find(p => p.id === id);
  const money = n => Number(n || 0).toFixed(3) + " " + CUR;
  const wa = text => `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(text)}`;
  const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#e8f3ea"/><text x="5" y="6.5" font-size="4" text-anchor="middle">🌱</text></svg>');
  const img = p => p.img || PLACEHOLDER;

  /* ---------- texts from settings ---------- */
  $$("[data-s]").forEach(el => { if (S[el.dataset.s]) el.textContent = S[el.dataset.s]; });
  if (S.name) document.title = document.title.replace("محمد بن سعيد العامري", S.name);

  /* ---------- Header / announcement ---------- */
  const nav = [["index.html", "الرئيسية", "home"], ["products.html", "المنتجات", "products"], ["about.html", "عنّي", "about"], ["contact.html", "تواصل معنا", "contact"]];
  document.body.insertAdjacentHTML("afterbegin", `<div class="announce">${esc(S.announcement || "")}</div>`);
  $("#site-header").innerHTML = `
    <div class="container header-row">
      <a class="brand" href="index.html"><span class="brand-mark">🌿</span><span><strong>${esc(S.name)}</strong><small>${esc(S.tagline)}</small></span></a>
      <nav class="nav" id="nav">${nav.map(([h, t, k]) => `<a href="${h}" class="${k === page ? "active" : ""}">${t}</a>`).join("")}</nav>
      <div class="header-actions">
        <button class="cart-btn" id="cart-open" aria-label="سلة المشتريات">🧺<span id="cart-count">0</span></button>
        <a class="btn btn-green hide-sm" target="_blank" rel="noopener" href="${wa("السلام عليكم، أريد الاستفسار عن المنتجات")}">اطلب عبر الواتساب</a>
        <button class="menu-btn" id="menu-btn" aria-label="القائمة">☰</button>
      </div>
    </div>`;
  $("#menu-btn").addEventListener("click", () => $("#nav").classList.toggle("open"));

  /* ---------- Footer ---------- */
  const socials = [["instagram", "Instagram"], ["tiktok", "TikTok"], ["facebook", "Facebook"], ["threads", "Threads"]].filter(([k]) => S[k]);
  $("#site-footer").innerHTML = `
    <div class="container footer-grid">
      <div><a class="brand light" href="index.html"><span class="brand-mark">🌿</span><span><strong>${esc(S.name)}</strong><small>${esc(S.tagline)}</small></span></a>
        <p>محتوى زراعي ومنتجات مختارة لعشاق الزراعة في سلطنة عُمان.</p></div>
      <div><h4>روابط</h4><a href="products.html">المنتجات</a><a href="about.html">عنّي</a><a href="contact.html">تواصل معنا</a></div>
      <div><h4>تابعني</h4>${socials.map(([k, t]) => `<a href="${esc(S[k])}" target="_blank" rel="noopener">${t}</a>`).join("") || `<a href="${wa("السلام عليكم")}" target="_blank">واتساب</a>`}</div>
    </div>
    <div class="copy">© ${new Date().getFullYear()} ${esc(S.name)} — جميع الحقوق محفوظة</div>`;
  $$("[data-wa]").forEach(a => { a.href = wa(a.dataset.wa || "السلام عليكم"); a.target = "_blank"; a.rel = "noopener"; });
  $$("[data-social]").forEach(a => { const u = S[a.dataset.social]; if (u) a.href = u; else a.closest("[data-social-wrap]")?.remove(); });

  /* ---------- Cart ---------- */
  let cart = store.get("agri-cart", {});
  const saveCart = () => { store.set("agri-cart", cart); renderCart(); };
  const customer = store.get("agri-customer", {});
  const GOVS = ["مسقط", "ظفار", "مسندم", "البريمي", "الداخلية", "شمال الباطنة", "جنوب الباطنة", "شمال الشرقية", "جنوب الشرقية", "الظاهرة", "الوسطى"];

  document.body.insertAdjacentHTML("beforeend", `
    <div class="drawer-bg" id="drawer-bg"></div>
    <aside class="drawer" id="drawer" aria-label="سلة المشتريات">
      <div class="drawer-head"><h3>🧺 سلة المشتريات</h3><button id="cart-close" aria-label="إغلاق">✕</button></div>
      <div class="drawer-body"><div id="cart-items"></div>
        <form class="checkout" id="checkout" hidden>
          <label>الاسم *<input name="name" required value="${esc(customer.name)}" autocomplete="name"></label>
          <div class="row2">
            <label>المحافظة *<select name="gov" required><option value="">اختر</option>${GOVS.map(g => `<option ${customer.gov === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
            <label>الولاية / المنطقة<input name="area" value="${esc(customer.area)}"></label>
          </div>
          <label>ملاحظات <small>(اختياري)</small><textarea name="notes" rows="2"></textarea></label>
        </form>
      </div>
      <div class="drawer-foot">
        <div class="total"><span>الإجمالي</span><strong id="cart-total">0</strong></div>
        <p class="note">${esc(S.delivery_note || "")}</p>
        <div class="err-msg" id="cart-err">الرجاء كتابة الاسم واختيار المحافظة</div>
        <button class="btn btn-green block" id="cart-send">إرسال الطلب عبر الواتساب</button>
        <button class="link-btn" id="cart-clear">تفريغ السلة</button>
      </div>
    </aside>
    <div class="modal-bg" id="modal-bg"><div class="modal" id="modal" role="dialog" aria-modal="true"></div></div>
    <div class="mbar" id="mbar"><span><span id="mbar-n"></span> · <b id="mbar-t"></b></span><button class="btn btn-green sm" id="mbar-open">عرض السلة</button></div>
    <div class="toast" id="toast"></div>`);

  const openCart = v => { $("#drawer").classList.toggle("open", v); $("#drawer-bg").classList.toggle("open", v); };
  $("#cart-open").onclick = () => openCart(true);
  $("#mbar-open").onclick = () => openCart(true);
  $("#cart-close").onclick = () => openCart(false);
  $("#drawer-bg").onclick = () => openCart(false);
  $("#cart-clear").onclick = () => { if (confirm("تفريغ السلة؟")) { cart = {}; saveCart(); } };

  const cartLines = () => Object.entries(cart).filter(([id]) => byId(id) && byId(id).available !== false);
  function renderCart() {
    const items = cartLines();
    const count = items.reduce((s, [, q]) => s + q, 0);
    const total = items.reduce((s, [id, q]) => s + byId(id).price * q, 0);
    const c = $("#cart-count"); c.textContent = count; c.style.display = count ? "" : "none";
    $("#cart-total").textContent = money(total);
    $("#mbar-n").textContent = `${count} منتج`; $("#mbar-t").textContent = money(total);
    $("#mbar").classList.toggle("show", count > 0); document.body.classList.toggle("has-mbar", count > 0);
    $("#checkout").hidden = !items.length;
    $("#cart-send").classList.toggle("disabled", !items.length);
    $("#cart-items").innerHTML = items.length ? items.map(([id, q]) => { const p = byId(id); return `
      <div class="cart-item">
        <div class="ci"><img class="thumb" src="${esc(img(p))}" alt="" onerror="this.onerror=null;this.src='${PLACEHOLDER}'"><div><strong>${esc(p.name)}</strong><small>${money(p.price)} × ${q} = ${money(p.price * q)}</small></div></div>
        <div class="qty"><button data-q="${id}" data-d="1" aria-label="زيادة">+</button><span>${q}</span><button data-q="${id}" data-d="-1" aria-label="إنقاص">−</button></div>
      </div>`; }).join("") : `<p class="empty">السلة فارغة 🌱<br>أضف المنتجات ثم أرسل طلبك عبر الواتساب.</p>`;
  }
  $("#cart-items").addEventListener("click", e => {
    const b = e.target.closest("[data-q]"); if (!b) return;
    const id = b.dataset.q; cart[id] = (cart[id] || 0) + Number(b.dataset.d);
    if (cart[id] <= 0) delete cart[id]; saveCart();
  });
  $("#cart-send").onclick = () => {
    const items = cartLines(); if (!items.length) return;
    const f = $("#checkout"), name = f.name.value.trim(), gov = f.gov.value, area = f.area.value.trim(), notes = f.notes.value.trim();
    if (!name || !gov) { $("#cart-err").style.display = "block"; (name ? f.gov : f.name).focus(); return; }
    $("#cart-err").style.display = "none";
    store.set("agri-customer", { name, gov, area });
    const no = "#" + Date.now().toString().slice(-6);
    const total = items.reduce((s, [id, q]) => s + byId(id).price * q, 0);
    const msg = [`السلام عليكم 🌱`, `طلب جديد ${no}`, ``,
      ...items.map(([id, q], i) => `${i + 1}. ${byId(id).name} × ${q} = ${money(byId(id).price * q)}`),
      ``, `الإجمالي: ${money(total)}`, ``, `الاسم: ${name}`, `العنوان: ${gov}${area ? " - " + area : ""}`, notes ? `ملاحظات: ${notes}` : ""].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    window.open(wa(msg), "_blank");
    toast("تم فتح الواتساب — اضغط إرسال لإتمام الطلب ✓");
  };

  function add(id, q = 1) { cart[id] = (cart[id] || 0) + q; saveCart(); toast(`أُضيف «${byId(id).name}» إلى السلة ✓`); }
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); }

  /* ---------- Product card ---------- */
  const discount = p => p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  const card = p => `
    <article class="product" data-id="${p.id}">
      <div class="product-img" data-view="${p.id}">
        <img loading="lazy" src="${esc(img(p))}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
        ${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}
        ${discount(p) ? `<span class="badge sale">-${discount(p)}%</span>` : ""}
        <span class="cat-tag">${esc(catOf(p.cat)?.name || "")}</span>
      </div>
      <div class="product-body">
        <h3 data-view="${p.id}">${esc(p.name)}</h3>
        <p>${esc((p.desc || "جودة مختارة للزراعة").split("\n")[0].slice(0, 70))}</p>
        <div class="product-foot">
          <span class="price">${money(p.price)}${discount(p) ? `<span class="old">${money(p.old_price)}</span>` : ""}</span>
          ${p.available === false
            ? `<a class="btn btn-light sm block" target="_blank" rel="noopener" href="${wa("السلام عليكم، متى يتوفر " + p.name + "؟")}">غير متوفر حالياً — اسأل عنه</a>`
            : `<div class="actions"><button class="btn btn-green sm" data-add="${p.id}">+ أضف للسلة</button><button class="btn btn-light sm" data-view="${p.id}">التفاصيل</button></div>`}
        </div>
      </div>
    </article>`;

  /* ---------- Quick view ---------- */
  function openProduct(id) {
    const p = byId(id); if (!p) return;
    let q = 1;
    $("#modal").innerHTML = `
      <button class="modal-close" id="m-close" aria-label="إغلاق">✕</button>
      <img src="${esc(img(p))}" alt="${esc(p.name)}" onerror="this.src='${PLACEHOLDER}'">
      <div class="modal-body">
        <span class="eyebrow" style="align-self:flex-start">${esc(catOf(p.cat)?.name || "")}</span>
        <h2>${esc(p.name)}</h2>
        <span class="price">${money(p.price)}${discount(p) ? `<span class="old">${money(p.old_price)}</span>` : ""}</span>
        <p class="desc">${esc(p.desc || "جودة مختارة للزراعة")}</p>
        ${p.available === false ? `<a class="btn btn-light block" target="_blank" rel="noopener" href="${wa("السلام عليكم، متى يتوفر " + p.name + "؟")}">غير متوفر حالياً — اسأل عن التوفر</a>` : `
        <div class="qty-row"><div class="qty big"><button id="m-plus">+</button><span id="m-q">1</span><button id="m-minus">−</button></div>
          <button class="btn btn-green" style="flex:1" id="m-add">أضف إلى السلة</button></div>
        <a class="btn btn-light block" target="_blank" rel="noopener" href="${wa("السلام عليكم، أريد الاستفسار عن " + p.name)}">استفسار عبر الواتساب</a>`}
        <button class="share" id="m-share">🔗 مشاركة المنتج</button>
      </div>`;
    $("#modal-bg").classList.add("open"); history.replaceState(null, "", "#p=" + id);
    $("#m-close").onclick = closeProduct;
    if ($("#m-add")) {
      $("#m-plus").onclick = () => $("#m-q").textContent = ++q;
      $("#m-minus").onclick = () => $("#m-q").textContent = q = Math.max(1, q - 1);
      $("#m-add").onclick = () => { add(id, q); closeProduct(); };
    }
    $("#m-share").onclick = async () => {
      const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "products.html#p=" + id;
      try { if (navigator.share) await navigator.share({ title: p.name, url }); else { await navigator.clipboard.writeText(url); toast("تم نسخ رابط المنتج ✓"); } } catch (e) {}
    };
  }
  function closeProduct() { $("#modal-bg").classList.remove("open"); history.replaceState(null, "", location.pathname + location.search); }
  $("#modal-bg").addEventListener("click", e => { if (e.target.id === "modal-bg") closeProduct(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeProduct(); openCart(false); } });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-add]"); if (a) return add(a.dataset.add);
    const v = e.target.closest("[data-view]"); if (v) openProduct(v.dataset.view);
  });

  /* ---------- Home ---------- */
  const featured = $("#featured-products");
  if (featured) {
    let list = PRODUCTS.filter(p => p.featured);
    if (!list.length) list = PRODUCTS.slice(0, 4);
    featured.innerHTML = list.slice(0, 8).map(card).join("");
  }
  const catGrid = $("#categories");
  if (catGrid) catGrid.innerHTML = CATS.map(c => `
    <a class="cat-card" href="products.html?cat=${encodeURIComponent(c.id)}">
      <img loading="lazy" src="${esc(c.img || PLACEHOLDER)}" alt="${esc(c.name)}">
      <div><h3>${esc(c.name)}</h3><p>${esc(c.sub)}</p></div>
    </a>`).join("");
  $("#home-search")?.addEventListener("submit", e => { e.preventDefault(); location.href = "products.html?q=" + encodeURIComponent($("#home-search input").value); });

  /* ---------- Products page ---------- */
  const all = $("#all-products");
  if (all) {
    const params = new URLSearchParams(location.search);
    let cat = params.get("cat") || "all", q = params.get("q") || "", sort = "default";
    const filters = $("#filters"), search = $("#search");
    filters.innerHTML = [["all", "الكل"], ...CATS.map(c => [c.id, c.name])].map(([k, t]) => `<button class="chip" data-cat="${esc(k)}">${esc(t)}</button>`).join("");
    search.value = q;
    const draw = () => {
      $$(".chip", filters).forEach(b => b.classList.toggle("active", b.dataset.cat === cat));
      const term = q.trim();
      let list = PRODUCTS.filter(p => (cat === "all" || p.cat === cat) && (!term || (p.name + " " + (p.desc || "")).includes(term)));
      if (sort === "low") list.sort((a, b) => a.price - b.price);
      if (sort === "high") list.sort((a, b) => b.price - a.price);
      if (sort === "new") list.sort((a, b) => (b.created || 0) - (a.created || 0));
      list.sort((a, b) => (a.available === false) - (b.available === false));   // available first
      all.innerHTML = list.length ? list.map(card).join("") : `<p class="empty wide">لا توجد منتجات مطابقة. <a target="_blank" href="${wa("السلام عليكم، أبحث عن " + term)}">اسألنا عبر الواتساب</a></p>`;
      $("#result-count").textContent = `${list.length} منتج`;
    };
    filters.addEventListener("click", e => { const b = e.target.closest(".chip"); if (b) { cat = b.dataset.cat; draw(); } });
    search.addEventListener("input", () => { q = search.value; draw(); });
    $("#sort").addEventListener("change", e => { sort = e.target.value; draw(); });
    draw();
  }

  /* open product from a shared link */
  const m = location.hash.match(/p=([\w-]+)/); if (m && byId(m[1])) openProduct(m[1]);

  /* structured data for Google */
  document.head.insertAdjacentHTML("beforeend", `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Store", name: S.name, description: S.tagline, telephone: "+" + S.whatsapp,
    address: { "@type": "PostalAddress", addressCountry: "OM" }, priceRange: CUR
  })}<\/script>`);

  renderCart();
})();
