(() => {
  const API = 'api/';

  const el = {
    loginView: document.getElementById('login-view'),
    appView: document.getElementById('app-view'),
    logoutBtn: document.getElementById('logout-btn'),
    loginForm: document.getElementById('login-form'),
    passwordInput: document.getElementById('password-input'),
    loginError: document.getElementById('login-error'),
    bookList: document.getElementById('book-list'),
    emptyState: document.getElementById('empty-state'),
    addBookBtn: document.getElementById('add-book-btn'),
    addBookOverlay: document.getElementById('add-book-overlay'),
    addBookForm: document.getElementById('add-book-form'),
    cancelAddBook: document.getElementById('cancel-add-book'),
    newTitle: document.getElementById('new-title'),
    newAuthor: document.getElementById('new-author'),
    newStartPage: document.getElementById('new-start-page'),
    newWeeklyTarget: document.getElementById('new-weekly-target'),
    detailOverlay: document.getElementById('book-detail-overlay'),
    detailCoverImg: document.getElementById('detail-cover-img'),
    detailCoverPlaceholder: document.getElementById('detail-cover-placeholder'),
    detailTitle: document.getElementById('detail-title'),
    detailAuthor: document.getElementById('detail-author'),
    detailPage: document.getElementById('detail-page'),
    detailHistory: document.getElementById('detail-history'),
    updatePageForm: document.getElementById('update-page-form'),
    updatePageInput: document.getElementById('update-page-input'),
    updateTargetForm: document.getElementById('update-target-form'),
    updateTargetInput: document.getElementById('update-target-input'),
    detailWeekCount: document.getElementById('detail-week-count'),
    detailWeekTarget: document.getElementById('detail-week-target'),
    detailProgressFill: document.getElementById('detail-progress-fill'),
    detailInspire: document.getElementById('detail-inspire'),
    deleteBookBtn: document.getElementById('delete-book-btn'),
    closeDetailBtn: document.getElementById('close-detail-btn'),
  };

  let books = [];
  let openBookId = null;

  async function api(path, options = {}) {
    const res = await fetch(API + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  function showApp() {
    el.loginView.hidden = true;
    el.appView.hidden = false;
    el.logoutBtn.hidden = false;
    loadBooks();
  }

  function showLogin() {
    el.loginView.hidden = false;
    el.appView.hidden = true;
    el.logoutBtn.hidden = true;
  }

  async function init() {
    try {
      const { authenticated } = await api('session.php');
      if (authenticated) {
        showApp();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.loginError.hidden = true;
    try {
      await api('login.php', {
        method: 'POST',
        body: JSON.stringify({ password: el.passwordInput.value }),
      });
      el.passwordInput.value = '';
      showApp();
    } catch (err) {
      el.loginError.textContent = err.message;
      el.loginError.hidden = false;
    }
  });

  el.logoutBtn.addEventListener('click', async () => {
    await api('logout.php', { method: 'POST' });
    showLogin();
  });

  function formatRelative(iso) {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }

  function formatFull(iso) {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }) + ' ' + date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function lastUpdate(book) {
    return book.history[book.history.length - 1]?.at || book.createdAt;
  }

  function pageLabel(book) {
    return book.totalPages
      ? `Page ${book.currentPage} of ${book.totalPages}`
      : `Page ${book.currentPage}`;
  }

  function renderCover(imgEl, placeholderEl, book) {
    if (book.coverUrl) {
      imgEl.src = book.coverUrl;
      imgEl.alt = `Cover of ${book.title}`;
      imgEl.hidden = false;
      placeholderEl.hidden = true;
      imgEl.onerror = () => {
        imgEl.hidden = true;
        placeholderEl.hidden = false;
      };
    } else {
      imgEl.hidden = true;
      placeholderEl.hidden = false;
    }
  }

  // The reading week runs Saturday 00:00 -> next Friday 23:59:59, local time.
  function getWeekStart(now = new Date()) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceSaturday = (start.getDay() - 6 + 7) % 7;
    start.setDate(start.getDate() - daysSinceSaturday);
    return start;
  }

  function pageAtWeekStart(book, weekStart) {
    let baseline = book.history[0]?.page ?? book.currentPage;
    for (const entry of book.history) {
      if (new Date(entry.at) <= weekStart) {
        baseline = entry.page;
      } else {
        break;
      }
    }
    return baseline;
  }

  function weeklyStats(book) {
    const weekStart = getWeekStart();
    const baseline = pageAtWeekStart(book, weekStart);
    const target = book.weeklyTarget || 30;
    const pagesThisWeek = Math.max(0, book.currentPage - baseline);
    const targetPage = baseline + target;
    const progress = Math.min(1, pagesThisWeek / target);
    const isComplete = pagesThisWeek >= target;
    return { pagesThisWeek, target, targetPage, progress, isComplete };
  }

  function inspireMessage({ progress, isComplete }) {
    if (isComplete) return '🎉 Weekly goal smashed!';
    if (progress >= 0.5) return '🚀 Great pace, keep going!';
    if (progress > 0) return '📖 Nice start this week!';
    return '✨ New week, fresh start!';
  }

  function renderWeekPanel({ countEl, targetEl, fillEl, msgEl }, book) {
    const stats = weeklyStats(book);
    countEl.textContent = `${stats.pagesThisWeek} / ${stats.target} pages this week`;
    targetEl.textContent = `Target: page ${stats.targetPage}`;
    fillEl.style.width = `${stats.progress * 100}%`;
    fillEl.classList.toggle('complete', stats.isComplete);
    msgEl.textContent = inspireMessage(stats);
  }

  function renderBooks() {
    el.bookList.innerHTML = '';
    el.emptyState.hidden = books.length > 0;

    for (const book of books) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'book-card';
      card.innerHTML = `
        <div class="cover">
          <img class="cover-img" hidden>
          <div class="cover-placeholder">📖</div>
        </div>
        <div class="book-card-body">
          <div class="title"></div>
          <div class="author"></div>
          <div class="progress-row">
            <span class="page"></span>
            <span class="updated"></span>
          </div>
          <div class="week-panel">
            <div class="week-stats">
              <span class="week-count"></span>
              <span class="week-target"></span>
            </div>
            <div class="progress-bar"><div class="progress-fill"></div></div>
            <div class="inspire-msg"></div>
          </div>
        </div>
      `;
      renderCover(card.querySelector('.cover-img'), card.querySelector('.cover-placeholder'), book);
      card.querySelector('.title').textContent = book.title;
      card.querySelector('.author').textContent = book.author || '';
      card.querySelector('.page').textContent = pageLabel(book);
      card.querySelector('.updated').textContent = formatRelative(lastUpdate(book));
      renderWeekPanel({
        countEl: card.querySelector('.week-count'),
        targetEl: card.querySelector('.week-target'),
        fillEl: card.querySelector('.progress-fill'),
        msgEl: card.querySelector('.inspire-msg'),
      }, book);
      card.addEventListener('click', () => openDetail(book.id));
      el.bookList.appendChild(card);
    }
  }

  async function loadBooks() {
    const data = await api('books.php');
    books = data.books;
    renderBooks();
  }

  el.addBookBtn.addEventListener('click', () => {
    el.addBookForm.reset();
    el.newStartPage.value = '0';
    el.newWeeklyTarget.value = '30';
    el.addBookOverlay.hidden = false;
  });

  el.cancelAddBook.addEventListener('click', () => {
    el.addBookOverlay.hidden = true;
  });

  // Best-effort cover + page-count lookup via Open Library. Never blocks or
  // fails book creation — any error just means no cover/page count.
  async function lookupBookMeta(title, author) {
    const fallback = { coverUrl: null, totalPages: null };
    if (!title) return fallback;

    const params = new URLSearchParams({
      title,
      limit: '1',
      fields: 'cover_i,number_of_pages_median',
    });
    if (author) params.set('author', author);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`https://openlibrary.org/search.json?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) return fallback;
      const data = await res.json();
      const doc = data.docs?.[0];
      if (!doc) return fallback;

      return {
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        totalPages: doc.number_of_pages_median ? Math.round(doc.number_of_pages_median) : null,
      };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  el.addBookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = el.newTitle.value.trim();
    const author = el.newAuthor.value.trim();

    const submitBtn = el.addBookForm.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Looking up cover…';

    try {
      const meta = await lookupBookMeta(title, author);
      await api('books.php', {
        method: 'POST',
        body: JSON.stringify({
          title,
          author,
          startPage: Number(el.newStartPage.value) || 0,
          weeklyTarget: Number(el.newWeeklyTarget.value) || 30,
          coverUrl: meta.coverUrl,
          totalPages: meta.totalPages,
        }),
      });
      el.addBookOverlay.hidden = true;
      loadBooks();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  function openDetail(bookId) {
    openBookId = bookId;
    renderDetail();
    el.detailOverlay.hidden = false;
  }

  function renderDetail() {
    const book = books.find((b) => b.id === openBookId);
    if (!book) return;

    renderCover(el.detailCoverImg, el.detailCoverPlaceholder, book);
    el.detailTitle.textContent = book.title;
    el.detailAuthor.textContent = book.author || '';
    el.detailPage.textContent = pageLabel(book);
    el.updatePageInput.value = book.currentPage;
    el.updateTargetInput.value = book.weeklyTarget;
    renderWeekPanel({
      countEl: el.detailWeekCount,
      targetEl: el.detailWeekTarget,
      fillEl: el.detailProgressFill,
      msgEl: el.detailInspire,
    }, book);

    el.detailHistory.innerHTML = '';
    const sorted = [...book.history].reverse();
    for (const entry of sorted) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="hist-page"></span>
        <span class="hist-date"></span>
      `;
      li.querySelector('.hist-page').textContent = `Page ${entry.page}`;
      li.querySelector('.hist-date').textContent = formatFull(entry.at);
      el.detailHistory.appendChild(li);
    }
  }

  el.updatePageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { book } = await api('entries.php', {
      method: 'POST',
      body: JSON.stringify({
        bookId: openBookId,
        page: Number(el.updatePageInput.value),
      }),
    });
    const idx = books.findIndex((b) => b.id === book.id);
    if (idx !== -1) books[idx] = book;
    renderDetail();
    renderBooks();
  });

  el.updateTargetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { book } = await api('books.php', {
      method: 'PATCH',
      body: JSON.stringify({
        id: openBookId,
        weeklyTarget: Number(el.updateTargetInput.value),
      }),
    });
    const idx = books.findIndex((b) => b.id === book.id);
    if (idx !== -1) books[idx] = book;
    renderDetail();
    renderBooks();
  });

  el.deleteBookBtn.addEventListener('click', async () => {
    const book = books.find((b) => b.id === openBookId);
    if (!book) return;
    if (!confirm(`Delete "${book.title}"? This cannot be undone.`)) return;

    await api(`books.php?id=${encodeURIComponent(openBookId)}`, {
      method: 'DELETE',
    });
    el.detailOverlay.hidden = true;
    loadBooks();
  });

  el.closeDetailBtn.addEventListener('click', () => {
    el.detailOverlay.hidden = true;
    openBookId = null;
  });

  init();
})();
