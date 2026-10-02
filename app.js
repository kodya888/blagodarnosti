// ——— Дневник благодарности: логика приложения ———
// Данные живут в телефоне (IndexedDB), сервер Supabase получает копии
// фоном, когда есть сеть. Работает офлайн полностью.
"use strict";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ——— Элементы ———
const authScreen = document.getElementById("auth-screen");
const appScreen  = document.getElementById("app-screen");
const authForm   = document.getElementById("auth-form");
const authEmail  = document.getElementById("auth-email");
const authPass   = document.getElementById("auth-password");
const authSubmit = document.getElementById("auth-submit");
const authError  = document.getElementById("auth-error");

const todayDate   = document.getElementById("today-date");
const entryText   = document.getElementById("entry-text");
const charCounter = document.getElementById("char-counter");
const saveBtn     = document.getElementById("save-btn");
const entryToast  = document.getElementById("entry-toast");
const syncBadge   = document.getElementById("sync-badge");

const listScreen   = document.getElementById("list-screen");
const entriesList  = document.getElementById("entries-list");
const entriesCount = document.getElementById("entries-count");
const listEmpty    = document.getElementById("list-empty");
const listError    = document.getElementById("list-error");
const searchInput  = document.getElementById("search-input");
const exportBtn    = document.getElementById("export-btn");

const navBtns = document.querySelectorAll(".nav-btn");

let currentUserId = null;

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", weekday: "long",
});
const TIME_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});
const EXPORT_DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", year: "numeric",
});
const EXPORT_TIME_FMT = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit", minute: "2-digit",
});

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : "xxxx-xxxx-xxxx".replace(/x/g, () =>
        Math.floor(Math.random() * 16).toString(16));
}

// ============================================================
// Локальное хранилище IndexedDB
// (встроенная в браузер база данных — работает без интернета)
// ============================================================
let idb = null;

function idbOpen() {
  return new Promise((resolve) => {
    const req = indexedDB.open("blagodarnosti", 1);
    // Схема хранилища задаётся один раз: записи, ключ — id
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("entries")) {
        d.createObjectStore("entries", { keyPath: "id" });
      }
    };
    req.onsuccess = () => { idb = req.result; resolve(); };
    req.onerror = () => resolve(); // без базы приложение работать не сможет
  });
}

function idbPut(entry) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("entries", "readwrite");
    tx.objectStore("entries").put(entry);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function idbAll() {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("entries", "readonly");
    const req = tx.objectStore("entries").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbMarkSynced(ids) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("entries", "readwrite");
    const store = tx.objectStore("entries");
    ids.forEach((id) => {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) store.put({ ...req.result, synced: 1 });
      };
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// Синхронизация: телефон → Supabase → телефон
// ============================================================
let syncing = false;

async function syncNow() {
  if (!idb || !currentUserId || !navigator.onLine || syncing) return;
  syncing = true;
  setSyncBadge("Синхронизация…");

  try {
    // Вверх: не отправленные записи → на сервер (upsert — вставка
    // без дублей по id)
    const pending = (await idbAll()).filter(r => !r.synced);
    if (pending.length) {
      const { error } = await db
        .from("entries")
        .upsert(pending.map(r => ({
          id: r.id, user_id: r.user_id,
          content: r.content, created_at: r.created_at,
        })), { onConflict: "id" });
      if (error) throw error;
      await idbMarkSynced(pending.map(r => r.id));
    }

    // Вниз: записи с сервера, которых ещё нет на телефоне
    const { data, error } = await db
      .from("entries")
      .select("id, user_id, content, created_at")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const known = new Set((await idbAll()).map(r => r.id));
    const fresh = data.filter(r => !known.has(r.id));
    for (const r of fresh) await idbPut({ ...r, synced: 1 });

    if (fresh.length) renderLocal();
    setSyncBadge(null);
  } catch {
    // Нет сети или сервер недоступен — записи не потерялись,
    // повторим при следующем сохранении/подключении
    setSyncBadge("Не отправлено — повторим при подключении");
  } finally {
    syncing = false;
  }
}

function setSyncBadge(text) {
  if (!text) { syncBadge.hidden = true; return; }
  syncBadge.textContent = text;
  syncBadge.hidden = false;
}

// ============================================================
// Навигация
// ============================================================
function showPage(id) {
  document.getElementById("entry-screen").hidden = id !== "entry-screen";
  document.getElementById("list-screen").hidden  = id !== "list-screen";
  navBtns.forEach(b => b.classList.toggle("active", b.dataset.target === id));
  if (id === "list-screen") renderLocal();
}

navBtns.forEach(btn =>
  btn.addEventListener("click", () => showPage(btn.dataset.target))
);

// ============================================================
// Вход
// ============================================================
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;
  authSubmit.textContent = "Входим…";

  const { error } = await db.auth.signInWithPassword({
    email: authEmail.value.trim(),
    password: authPass.value,
  });

  authSubmit.disabled = false;
  authSubmit.textContent = "Войти";

  if (error) {
    const msg = error.message.toLowerCase();

    // Если аккаунта ещё нет — создаём при первом входе
    if (msg.includes("invalid login")) {
      const { error: signUpError } = await db.auth.signUp({
        email: authEmail.value.trim(),
        password: authPass.value,
      });
      if (!signUpError) { afterAuth(); return; }

      const s = signUpError.message.toLowerCase();
      if (s.includes("already registered")) {
        authError.textContent = "Аккаунт с таким e-mail уже есть, но пароль не подходит. Введите пароль, который вы задавали при первом входе (минимум 6 символов).";
      } else if (s.includes("rate limit") || s.includes("attempt")) {
        authError.textContent = "Слишком много попыток. Подождите пару минут и попробуйте снова.";
      } else {
        authError.textContent = signUpError.message;
      }
    } else if (msg.includes("not confirmed")) {
      authError.textContent = "E-mail ещё не подтверждён. Откройте письмо от Supabase («Confirm signup» — проверьте и папку Спам) и перейдите по ссылке, затем войдите снова.";
    } else if (msg.includes("rate limit") || msg.includes("attempt")) {
      authError.textContent = "Слишком много попыток входа. Подождите пару минут и попробуйте снова.";
    } else if (msg.includes("fetch") || msg.includes("network")) {
      authError.textContent = "Нет связи с сервером. Для первого входа нужен интернет — приложению надо зарегистрировать вас. Потом будет работать и без сети.";
    } else {
      authError.textContent = error.message;
    }
    authError.hidden = false;
    return;
  }
  afterAuth();
});

async function afterAuth() {
  authPass.value = "";
  // Сессия хранится локально в телефоне — сервер для этого не нужен,
  // поэтому приложение открывается даже при плохой связи
  const { data } = await db.auth.getSession();
  currentUserId = data.session ? data.session.user.id : null;
  authScreen.hidden = true;
  appScreen.hidden = false;
  allEntries = [];
  await renderLocal();
  showPage("entry-screen");
  syncNow();
}

async function signOutNow() {
  await db.auth.signOut();
  appScreen.hidden = true;
  authScreen.hidden = false;
}

// ============================================================
// Экран записи
// ============================================================
function updateCounter() {
  charCounter.textContent = `${entryText.value.length} / 2000`;
}
entryText.addEventListener("input", updateCounter);

saveBtn.addEventListener("click", async () => {
  const content = entryText.value.trim();
  if (!content) { entryText.focus(); return; }
  saveBtn.disabled = true;

  const entry = {
    id: uuid(),
    user_id: currentUserId,
    content,
    created_at: new Date().toISOString(),
    synced: 0,
  };

  try {
    await idbPut(entry);
  } catch (e) {
    alert("Не удалось сохранить на телефоне: " + e.message);
    saveBtn.disabled = false;
    return;
  }

  entryText.value = "";
  updateCounter();
  showToast();
  entryText.focus();
  saveBtn.disabled = false;

  renderLocal();

  // Отправка на сервер — в фоне, не мешая продолжать писать
  syncNow();
});

function showToast() {
  entryToast.textContent = navigator.onLine
    ? "Сохранено ✓"
    : "Сохранено на телефоне ✓ отправим при подключении";
  entryToast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { entryToast.hidden = true; }, 2200);
}

// Индикатор состояния сети
function updateSyncBadge() {
  if (navigator.onLine) syncNow();
  else setSyncBadge("Офлайн — записи сохраняются на телефоне");
}
window.addEventListener("online", updateSyncBadge);
window.addEventListener("offline", () => setSyncBadge("Офлайн — записи сохраняются на телефоне"));

// ============================================================
// Экран списка
// ============================================================
let allEntries = []; // записи с телефона (для поиска)

async function renderLocal() {
  try {
    const rows = await idbAll();
    allEntries = rows
      .filter(r => r.user_id === currentUserId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch (e) {
    listError.textContent = "Ошибка локального хранилища: " + e.message;
    listError.hidden = false;
    return;
  }
  renderList();
  listError.hidden = true;
}

// Точный поиск по подстроке; если точного нет — пробуем слово без
// последней буквы (падежные окончания: «липа» найдёт «липой»)
function matchesSearch(text, query) {
  return query.split(/\s+/).every(w => {
    if (text.includes(w)) return true;
    const stem = w.length >= 4 ? w.slice(0, -1) : "";
    return stem.length > 2 && text.includes(stem);
  });
}

// Показываем записи с учётом строки поиска
function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const shown = query
    ? allEntries.filter(r => matchesSearch(r.content.toLowerCase(), query))
    : allEntries;

  entriesCount.textContent = allEntries.length ? String(allEntries.length) : "";
  listEmpty.hidden = shown.length > 0;
  if (shown.length) {
    listEmpty.hidden = true;
  } else if (query && allEntries.length) {
    listEmpty.textContent = "Ничего не найдено по этому слову.";
  } else if (!allEntries.length && !navigator.onLine) {
    listEmpty.textContent = "Офлайн и на телефоне пока нет записей.\nПодключитесь к сети — подтянем с сервера.";
  } else {
    listEmpty.textContent = "Пока нет записей.\nПервая — самая близкая ✍️";
  }
  entriesList.replaceChildren(...shown.map(renderEntry));
}

function renderEntry(row) {
  const el = document.createElement("article");
  el.className = "entry";

  const date = document.createElement("div");
  date.className = "entry-date";
  date.textContent = TIME_FMT.format(new Date(row.created_at));
  if (!row.synced) {
    const mark = document.createElement("span");
    mark.className = "entry-unsynced";
    mark.textContent = " · не отправлено";
    date.append(mark);
  }

  const text = document.createElement("div");
  text.className = "entry-text";
  text.textContent = row.content;

  el.append(date, text);
  return el;
}

// ——— Экспорт всех записей в файл ———
exportBtn.addEventListener("click", async () => {
  if (!allEntries.length) {
    listEmpty.textContent = "Нет записей, чтобы экспортировать.";
    listEmpty.hidden = false;
    searchInput.focus();
    return;
  }
  const lines = ["# Благодарности", ""];
  for (const r of allEntries) {
    lines.push(
      "## " + EXPORT_DATE_FMT.format(new Date(r.created_at))
        + ", " + EXPORT_TIME_FMT.format(new Date(r.created_at)),
      "",
      r.content,
      "",
      "---",
      ""
    );
  }
  const name = "blagodarnosti_" + new Date().toISOString().slice(0, 10) + ".md";

  // Телефон: системное окно «Поделиться» — оттуда файл можно сохранить
  // в файлы, отправить себе и т.д. Самый надёжный путь из PWA.
  try {
    const file = new File(
      [new Blob([lines.join("\n")], { type: "text/markdown" })],
      name, { type: "text/markdown" }
    );
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Благодарности" });
      return;
    }
  } catch (e) {
    // Пользователь закрыл окно «Поделиться» — на этом всё, не ошибка
    if (e && e.name === "AbortError") return;
  }

  // Запасной путь: обычное скачивание (компьютер и старые браузеры)
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ============================================================
// Старт
// ============================================================
(async function init() {
  todayDate.textContent = DATE_FMT.format(new Date());
  updateCounter();
  setSyncBadge(navigator.onLine ? null : "Офлайн — записи сохраняются на телефоне");

  if (SUPABASE_URL.includes("ВАШ-ПРОЕКТ")) {
    authError.textContent = "Заполните config.js (URL и ключ Supabase) — см. README.";
    authError.hidden = false;
  }

  await idbOpen();

  const { data } = await db.auth.getSession();
  if (data.session) afterAuth();
  else authScreen.hidden = false;

  // Реакция на вход/выход (в т.ч. в другой вкладке)
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") signOutNow();
  });

  // Регистрация service worker — без неё офлайн-кэш не работает
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js");
  }
})();