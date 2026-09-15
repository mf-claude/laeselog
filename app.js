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
    detailOverlay: document.getElementById('book-detail-overlay'),
    detailTitle: document.getElementById('detail-title'),
    detailAuthor: document.getElementById('detail-author'),
    detailHistory: document.getElementById('detail-history'),
    updatePageForm: document.getElementById('update-page-form'),
    updatePageInput: document.getElementById('update-page-input'),
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

  function renderBooks() {
    el.bookList.innerHTML = '';
    el.emptyState.hidden = books.length > 0;

    for (const book of books) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'book-card';
      card.innerHTML = `
        <div class="title"></div>
        <div class="author"></div>
        <div class="progress-row">
          <span class="page"></span>
          <span class="updated"></span>
        </div>
        <div class="target"></div>
      `;
      card.querySelector('.title').textContent = book.title;
      card.querySelector('.author').textContent = book.author || '';
      card.querySelector('.page').textContent = `Page ${book.currentPage}`;
      card.querySelector('.updated').textContent = formatRelative(lastUpdate(book));
      card.querySelector('.target').textContent = `Target: page ${book.currentPage + 30}`;
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
    el.addBookOverlay.hidden = false;
  });

  el.cancelAddBook.addEventListener('click', () => {
    el.addBookOverlay.hidden = true;
  });

  el.addBookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('books.php', {
      method: 'POST',
      body: JSON.stringify({
        title: el.newTitle.value.trim(),
        author: el.newAuthor.value.trim(),
        startPage: Number(el.newStartPage.value) || 0,
      }),
    });
    el.addBookOverlay.hidden = true;
    loadBooks();
  });

  function openDetail(bookId) {
    openBookId = bookId;
    renderDetail();
    el.detailOverlay.hidden = false;
  }

  function renderDetail() {
    const book = books.find((b) => b.id === openBookId);
    if (!book) return;

    el.detailTitle.textContent = book.title;
    el.detailAuthor.textContent = book.author || '';
    el.updatePageInput.value = book.currentPage + 30;

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
