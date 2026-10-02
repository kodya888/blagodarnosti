// ——— Дневник благодарности: логика приложения ———
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

const listScreen   = document.getElementById("list-screen");
const entriesList  = document.getElementById("entries-list");
const entriesCount = document.getElementById("entries-count");
const listEmpty    = document.getElementById("list-empty");
const listError    = document.getElementById("list-error");
const searchInput  = document.getElementById("search-input");

let allEntries = []; // последняя загруженная порция записей (для поиска)

const navBtns = document.querySelectorAll(".nav-btn");

let currentUserId = null;

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", weekday: "long",
});
const TIME_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});

// ——— Навигация между двумя экранами ———
function showPage(id) {
  document.getElementById("entry-screen").hidden = id !== "entry-screen";
  document.getElementById("list-screen").hidden  = id !== "list-screen";
  navBtns.forEach(b => b.classList.toggle("active", b.dataset.target === id));
  if (id === "list-screen") loadEntries();
}

navBtns.forEach(btn =>
  btn.addEventListener("click", () => showPage(btn.dataset.target))
);

// ——— Вход ———
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
      authError.textContent = "Нет связи с сервером Supabase. Проверьте интернет и обновите страницу.";
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
  showPage("entry-screen");
}

function signOutNow() {
  db.auth.signOut().then(() => {
    appScreen.hidden = true;
    authScreen.hidden = false;
  });
}

// ——— Экран записи ———
function updateCounter() {
  charCounter.textContent = `${entryText.value.length} / 2000`;
}
entryText.addEventListener("input", updateCounter);

saveBtn.addEventListener("click", async () => {
  const content = entryText.value.trim();
  if (!content) { entryText.focus(); return; }
  saveBtn.disabled = true;
  saveBtn.textContent = "Сохраняем…";

  const { error } = await db
    .from("entries")
    .insert({ content, user_id: currentUserId });

  saveBtn.disabled = false;
  saveBtn.textContent = "Сохранить";

  if (error) {
    alert("Не удалось сохранить: " + error.message);
    return;
  }
  entryText.value = "";
  updateCounter();
  showToast();
  entryText.focus();
});

function showToast() {
  entryToast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { entryToast.hidden = true; }, 1800);
}

// ——— Экран списка ———
async function loadEntries() {
  listError.hidden = true;
  const { data, error } = await db
    .from("entries")
    .select("id, content, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    listError.textContent = "Ошибка загрузки: " + error.message;
    listError.hidden = false;
    return;
  }

  allEntries = data;
  renderList();
}

// Показываем записи с учётом строки поиска
function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const shown = query
    ? allEntries.filter(r => r.content.toLowerCase().includes(query))
    : allEntries;

  entriesCount.textContent = allEntries.length ? String(allEntries.length) : "";
  listEmpty.hidden = shown.length > 0;
  listEmpty.textContent = query && allEntries.length
    ? "Ничего не найдено по этому слову."
    : "Пока нет записей.\nПервая — самая близкая ✍️";
  entriesList.replaceChildren(...shown.map(renderEntry));
}

searchInput.addEventListener("input", renderList);

function renderEntry(row) {
  const el = document.createElement("article");
  el.className = "entry";

  const date = document.createElement("div");
  date.className = "entry-date";
  date.textContent = TIME_FMT.format(new Date(row.created_at));

  const text = document.createElement("div");
  text.className = "entry-text";
  text.textContent = row.content;

  el.append(date, text);
  return el;
}

// ——— Старт ———
(async function init() {
  todayDate.textContent = DATE_FMT.format(new Date());
  updateCounter();

  if (SUPABASE_URL.includes("ВАШ-ПРОЕКТ")) {
    authError.textContent = "Заполните config.js (URL и ключ Supabase) — см. README.";
    authError.hidden = false;
  }

  const { data } = await db.auth.getSession();
  if (data.session) afterAuth();
  else authScreen.hidden = false;

  // Реакция на вход/выход (в т.ч. в другой вкладке)
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") signOutNow();
  });
})();