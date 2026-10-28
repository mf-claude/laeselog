(() => {
  const API = 'api/';

  const el = {
    loginView: document.getElementById('login-view'),
    appView: document.getElementById('app-view'),
    logoutBtn: document.getElementById('logout-btn'),
    greeting: document.getElementById('greeting'),
    readerSwitch: document.getElementById('reader-switch'),
    readerGoal: document.getElementById('reader-goal'),
    goalCount: document.getElementById('goal-count'),
    goalDays: document.getElementById('goal-days'),
    goalFill: document.getElementById('goal-fill'),
    goalInspire: document.getElementById('goal-inspire'),
    goalForm: document.getElementById('goal-form'),
    goalInput: document.getElementById('goal-input'),
    goalHint: document.getElementById('goal-hint'),
    newWeeklyTargetField: document.getElementById('new-weekly-target-field'),
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
    newTotalPages: document.getElementById('new-total-pages'),
    findBookBtn: document.getElementById('find-book-btn'),
    matchStatus: document.getElementById('match-status'),
    matchResults: document.getElementById('match-results'),
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
    detailComment: document.getElementById('detail-comment'),
    detailBookProgress: document.getElementById('detail-book-progress'),
    detailBookCount: document.getElementById('detail-book-count'),
    detailBookLeft: document.getElementById('detail-book-left'),
    detailBookFill: document.getElementById('detail-book-fill'),
    updateTotalForm: document.getElementById('update-total-form'),
    updateTotalInput: document.getElementById('update-total-input'),
    deleteBookBtn: document.getElementById('delete-book-btn'),
    closeDetailBtn: document.getElementById('close-detail-btn'),
  };

  const READER_KEY = 'laeselog.reader';

  let books = [];
  let readers = [];
  let currentReaderId = loadSavedReader();
  let openBookId = null;

  // Add-book match flow: 'idle' (not searched yet), 'choosing' (results
  // shown, nothing picked), 'chosen' (a result picked) or 'none' (user said
  // none of the results fit, or there were none).
  let matchState = 'idle';
  let selectedMatch = null;

  // Book whose comment is being written by Claude right now.
  let pendingCommentId = null;

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
    loadAll();
  }

  // The chosen reader is a per-device convenience; storage may be blocked.
  function loadSavedReader() {
    try {
      return localStorage.getItem(READER_KEY);
    } catch {
      return null;
    }
  }

  function saveReader(id) {
    try {
      localStorage.setItem(READER_KEY, id);
    } catch {
      // Not remembered; the app still works.
    }
  }

  function currentReader() {
    return readers.find((r) => r.id === currentReaderId) || readers[0];
  }

  function hasWeekGoal(reader = currentReader()) {
    return reader?.goalMode === 'week';
  }

  function readerBooks(reader = currentReader()) {
    return books.filter((b) => b.readerId === reader?.id);
  }

  function selectReader(id) {
    currentReaderId = id;
    saveReader(id);
    renderReaders();
    renderBooks();
  }

  function renderReaders() {
    const reader = currentReader();
    el.greeting.textContent = reader ? `Hej ${reader.name}` : '';
    el.readerSwitch.innerHTML = '';
    for (const r of readers) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(r.id === reader?.id));
      btn.textContent = r.name;
      btn.addEventListener('click', () => selectReader(r.id));
      el.readerSwitch.appendChild(btn);
    }
    // The goal input is only filled here, so a re-render while typing
    // doesn't wipe what's been typed.
    if (hasWeekGoal(reader)) {
      el.goalInput.value = goalForWeek(reader).goal;
    }
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

  // Local-date key for a week, e.g. "2026-10-17" (its Saturday).
  function weekKey(weekStart = getWeekStart()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`;
  }

  // A week without its own goal keeps the most recent earlier one.
  function goalForWeek(reader, key = weekKey()) {
    const goals = reader.weeklyGoals || {};
    if (goals[key]) return { goal: goals[key], status: 'set' };
    const earlier = Object.keys(goals).filter((k) => k < key).sort().pop();
    if (earlier) return { goal: goals[earlier], status: 'carried' };
    return { goal: 30, status: 'unset' };
  }

  function daysLeftInWeek(weekStart) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return Math.ceil((weekEnd - new Date()) / (1000 * 60 * 60 * 24));
  }

  function pagesReadThisWeek(book, weekStart) {
    return Math.max(0, book.currentPage - pageAtWeekStart(book, weekStart));
  }

  function goalStats(pagesThisWeek, target, weekStart) {
    return {
      pagesThisWeek,
      target,
      progress: Math.min(1, pagesThisWeek / target),
      isComplete: pagesThisWeek >= target,
      daysLeft: daysLeftInWeek(weekStart),
    };
  }

  function weeklyStats(book) {
    const weekStart = getWeekStart();
    const target = book.weeklyTarget || 30;
    return {
      ...goalStats(pagesReadThisWeek(book, weekStart), target, weekStart),
      targetPage: pageAtWeekStart(book, weekStart) + target,
    };
  }

  // Week totals across all of a 'week'-mode reader's books.
  function readerWeekStats(reader) {
    const weekStart = getWeekStart();
    const pagesThisWeek = readerBooks(reader)
      .reduce((sum, book) => sum + pagesReadThisWeek(book, weekStart), 0);
    return goalStats(pagesThisWeek, goalForWeek(reader).goal, weekStart);
  }

  // What the comment prompt is told about the week: the book's own target,
  // or the reader's goal across all books.
  function commentWeekStats(book) {
    const reader = readers.find((r) => r.id === book.readerId);
    return hasWeekGoal(reader) ? readerWeekStats(reader) : weeklyStats(book);
  }

  function inspireMessage({ progress, isComplete }) {
    if (isComplete) return '🎉 Weekly goal smashed!';
    if (progress >= 0.5) return '🚀 Great pace, keep going!';
    if (progress > 0) return '📖 Nice start this week!';
    return '✨ New week, fresh start!';
  }

  function renderWeekPanel({ countEl, targetEl, fillEl, msgEl }, book) {
    const countOnly = hasWeekGoal();
    countEl.closest('.week-panel').classList.toggle('week-count-only', countOnly);
    if (countOnly) {
      countEl.textContent = `${pagesReadThisWeek(book, getWeekStart())} pages this week`;
      return;
    }
    const stats = weeklyStats(book);
    countEl.textContent = `${stats.pagesThisWeek} / ${stats.target} pages this week`;
    targetEl.textContent = `Target: page ${stats.targetPage}`;
    fillEl.style.width = `${stats.progress * 100}%`;
    fillEl.classList.toggle('complete', stats.isComplete);
    msgEl.textContent = inspireMessage(stats);
  }

  function renderComment(bubbleEl, book) {
    const latest = book.comments[book.comments.length - 1];
    const pending = pendingCommentId === book.id;
    bubbleEl.hidden = !pending && !latest;
    bubbleEl.classList.toggle('pending', pending);
    bubbleEl.textContent = pending ? '💭 …' : latest?.text || '';
  }

  function renderBookProgress({ panelEl, countEl, leftEl, fillEl }, book) {
    if (!book.totalPages) {
      panelEl.hidden = true;
      return;
    }
    const progress = Math.min(1, book.currentPage / book.totalPages);
    const pagesLeft = Math.max(0, book.totalPages - book.currentPage);
    panelEl.hidden = false;
    countEl.textContent = `${Math.round(progress * 100)}% of the book`;
    leftEl.textContent = pagesLeft > 0 ? `${pagesLeft} pages left` : '🏁 Finished!';
    fillEl.style.width = `${progress * 100}%`;
    fillEl.classList.toggle('complete', pagesLeft === 0);
  }

  function formatDay(date) {
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function renderReaderGoal() {
    const reader = currentReader();
    el.readerGoal.hidden = !hasWeekGoal(reader);
    if (el.readerGoal.hidden) return;

    const stats = readerWeekStats(reader);
    const { status } = goalForWeek(reader);
    el.goalCount.textContent = `${stats.pagesThisWeek} / ${stats.target} pages this week`;
    el.goalDays.textContent = stats.daysLeft === 1 ? '1 day left' : `${stats.daysLeft} days left`;
    el.goalFill.style.width = `${stats.progress * 100}%`;
    el.goalFill.classList.toggle('complete', stats.isComplete);
    el.goalInspire.textContent = inspireMessage(stats);

    const weekStart = getWeekStart();
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const range = `${formatDay(weekStart)} – ${formatDay(weekEnd)}`;
    el.goalHint.textContent = {
      set: `Set for this week (${range})`,
      carried: `Carried over from last week. Change it if this week (${range}) is different`,
      unset: `No goal set yet. Pick one for this week (${range})`,
    }[status];
  }

  function renderBooks() {
    const visible = readerBooks();
    renderReaderGoal();
    el.bookList.innerHTML = '';
    el.emptyState.hidden = visible.length > 0;

    for (const book of visible) {
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
          <div class="comment-bubble" hidden></div>
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
            <div class="book-progress" hidden>
              <div class="week-stats">
                <span class="book-count"></span>
                <span class="week-target book-left"></span>
              </div>
              <div class="progress-bar"><div class="progress-fill book-fill"></div></div>
            </div>
          </div>
        </div>
      `;
      renderCover(card.querySelector('.cover-img'), card.querySelector('.cover-placeholder'), book);
      card.querySelector('.title').textContent = book.title;
      card.querySelector('.author').textContent = book.author || '';
      renderComment(card.querySelector('.comment-bubble'), book);
      card.querySelector('.page').textContent = pageLabel(book);
      card.querySelector('.updated').textContent = formatRelative(lastUpdate(book));
      renderWeekPanel({
        countEl: card.querySelector('.week-count'),
        targetEl: card.querySelector('.week-target'),
        fillEl: card.querySelector('.progress-fill'),
        msgEl: card.querySelector('.inspire-msg'),
      }, book);
      renderBookProgress({
        panelEl: card.querySelector('.book-progress'),
        countEl: card.querySelector('.book-count'),
        leftEl: card.querySelector('.book-left'),
        fillEl: card.querySelector('.book-fill'),
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

  async function loadAll() {
    const [readerData, bookData] = await Promise.all([api('readers.php'), api('books.php')]);
    readers = readerData.readers;
    books = bookData.books;
    renderReaders();
    renderBooks();
  }

  el.goalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = el.goalForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const data = await api('readers.php', {
        method: 'PATCH',
        body: JSON.stringify({
          id: currentReader().id,
          weekStart: weekKey(),
          weeklyGoal: Number(el.goalInput.value),
        }),
      });
      readers = data.readers;
      renderReaders();
      renderBooks();
    } finally {
      submitBtn.disabled = false;
    }
  });

  function resetMatch() {
    matchState = 'idle';
    selectedMatch = null;
    el.matchResults.hidden = true;
    el.matchResults.innerHTML = '';
    el.matchStatus.hidden = true;
  }

  function showMatchStatus(text) {
    el.matchStatus.textContent = text;
    el.matchStatus.hidden = false;
  }

  el.addBookBtn.addEventListener('click', () => {
    el.addBookForm.reset();
    el.newStartPage.value = '0';
    el.newWeeklyTarget.value = '30';
    el.newWeeklyTargetField.hidden = hasWeekGoal();
    resetMatch();
    el.addBookOverlay.hidden = false;
  });

  el.cancelAddBook.addEventListener('click', () => {
    el.addBookOverlay.hidden = true;
  });

  // Typing a new title/author makes any earlier search results stale.
  for (const input of [el.newTitle, el.newAuthor]) {
    input.addEventListener('input', () => {
      if (matchState !== 'idle') resetMatch();
    });
  }

  function pagesText(match) {
    if (!match.totalPages) return 'Page count unknown';
    return match.pagesEstimated ? `~${match.totalPages} pages (estimate)` : `${match.totalPages} pages`;
  }

  function selectMatch(match, optionEl) {
    selectedMatch = match;
    matchState = match ? 'chosen' : 'none';
    for (const opt of el.matchResults.querySelectorAll('.match-option')) {
      opt.classList.toggle('selected', opt === optionEl);
    }
    if (match) {
      el.newTitle.value = match.title;
      el.newAuthor.value = match.author || el.newAuthor.value;
      el.newTotalPages.value = match.totalPages || '';
      showMatchStatus(match.totalPages
        ? '✅ Book chosen. Check the page count matches your copy.'
        : '✅ Book chosen. Add the page count from your copy if you can.');
    } else {
      showMatchStatus('OK — the book will be added without a cover.');
    }
  }

  function renderMatches(results) {
    el.matchResults.innerHTML = '';
    for (const match of results) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'match-option';
      opt.innerHTML = `
        <div class="cover match-cover">
          <img class="cover-img" hidden>
          <div class="cover-placeholder">📖</div>
        </div>
        <div class="match-body">
          <div class="match-title"></div>
          <div class="match-meta"></div>
          <div class="match-pages"></div>
        </div>
      `;
      renderCover(opt.querySelector('.cover-img'), opt.querySelector('.cover-placeholder'), match);
      opt.querySelector('.match-title').textContent = match.title;
      opt.querySelector('.match-meta').textContent = [
        match.author,
        match.year,
        match.language === 'da' ? '🇩🇰 Danish' : null,
      ].filter(Boolean).join(' · ');
      opt.querySelector('.match-pages').textContent = pagesText(match);
      opt.addEventListener('click', () => selectMatch(match, opt));
      el.matchResults.appendChild(opt);
    }

    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'match-option match-none';
    none.textContent = 'None of these — add without a match';
    none.addEventListener('click', () => selectMatch(null, none));
    el.matchResults.appendChild(none);
    el.matchResults.hidden = false;
  }

  async function findBook() {
    const title = el.newTitle.value.trim();
    const author = el.newAuthor.value.trim();
    if (!title) {
      el.newTitle.reportValidity();
      return;
    }

    resetMatch();
    el.findBookBtn.disabled = true;
    showMatchStatus('Searching…');
    try {
      const params = new URLSearchParams({ title });
      if (author) params.set('author', author);
      const { results } = await api(`lookup.php?${params}`);
      if (results.length === 0) {
        matchState = 'none';
        showMatchStatus('No match found. You can still add the book — type the page count yourself.');
        return;
      }
      matchState = 'choosing';
      showMatchStatus('Which one is your book? Tap the right one.');
      renderMatches(results);
    } catch {
      matchState = 'none';
      showMatchStatus('Could not search right now. You can still add the book.');
    } finally {
      el.findBookBtn.disabled = false;
    }
  }

  el.findBookBtn.addEventListener('click', findBook);

  el.addBookForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Make sure the user has looked at the matches before adding the book.
    if (matchState === 'idle') {
      await findBook();
      return;
    }
    if (matchState === 'choosing') {
      showMatchStatus('👆 Pick your book in the list, or choose "None of these".');
      el.matchStatus.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    const submitBtn = el.addBookForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api('books.php', {
        method: 'POST',
        body: JSON.stringify({
          readerId: currentReader().id,
          title: el.newTitle.value.trim(),
          author: el.newAuthor.value.trim(),
          startPage: Number(el.newStartPage.value) || 0,
          weeklyTarget: Number(el.newWeeklyTarget.value) || 30,
          coverUrl: selectedMatch?.coverUrl ?? null,
          totalPages: Number(el.newTotalPages.value) || null,
        }),
      });
      el.addBookOverlay.hidden = true;
      loadBooks();
    } finally {
      submitBtn.disabled = false;
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
    renderComment(el.detailComment, book);
    el.detailPage.textContent = pageLabel(book);
    el.updatePageInput.value = book.currentPage;
    el.updateTargetInput.value = book.weeklyTarget;
    el.updateTargetForm.hidden = hasWeekGoal();
    el.updateTotalInput.value = book.totalPages ?? '';
    renderWeekPanel({
      countEl: el.detailWeekCount,
      targetEl: el.detailWeekTarget,
      fillEl: el.detailProgressFill,
      msgEl: el.detailInspire,
    }, book);
    renderBookProgress({
      panelEl: el.detailBookProgress,
      countEl: el.detailBookCount,
      leftEl: el.detailBookLeft,
      fillEl: el.detailBookFill,
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
    replaceBook(book);
    requestComment(book);
  });

  function replaceBook(book) {
    const idx = books.findIndex((b) => b.id === book.id);
    if (idx !== -1) books[idx] = book;
    renderDetail();
    renderBooks();
  }

  // Ask Claude for a fresh comment on the new page count. Best-effort: on
  // failure the previous comment (if any) just stays.
  async function requestComment(book) {
    const stats = commentWeekStats(book);
    pendingCommentId = book.id;
    renderDetail();
    renderBooks();
    try {
      const { book: updated } = await api('comment.php', {
        method: 'POST',
        body: JSON.stringify({
          bookId: book.id,
          pagesThisWeek: stats.pagesThisWeek,
          weeklyTarget: stats.target,
          daysLeftInWeek: stats.daysLeft,
        }),
      });
      if (pendingCommentId === book.id) pendingCommentId = null;
      replaceBook(updated);
    } catch {
      if (pendingCommentId === book.id) pendingCommentId = null;
      renderDetail();
      renderBooks();
    }
  }

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

  el.updateTotalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { book } = await api('books.php', {
      method: 'PATCH',
      body: JSON.stringify({
        id: openBookId,
        totalPages: Number(el.updateTotalInput.value) || null,
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
