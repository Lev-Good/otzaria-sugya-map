/* ============================================================================
   מבנה הסוגיא — לוגיקת אפליקציה מלאה (נוצר ע"י לב טוב)
   תרשים עץ מסתעף, חלונית קריאת מקורות מובנית, ניהול סוגיות, הגדרות ומדריך אינטראקטיבי
   ============================================================================ */
(function () {
  'use strict';

  const Bridge = window.SugyaBridge;
  const Data = window.SugyaData;

  const STORAGE_KEY = 'sugya_workspace_v1';
  const MAX_HISTORY = 40;
  const READER_CHUNK_LINES = 26;

  let workspace = {
    schemaVersion: 1,
    activeChartId: null,
    charts: [],
    settings: Object.assign({}, Data.DEFAULT_SETTINGS)
  };

  let currentZoom = 1;
  let activeFilterType = null;

  // היסטוריית ביטול / ביצוע שוב לסוגיה הפעילה
  let undoStack = [];
  let redoStack = [];
  let textUndoSnapshotPending = true;

  // מצבי מודאלים
  let pickerState = { mode: 'add', parentId: null, nodeId: null };
  let sourceModalNodeId = null;
  let sourceSearchTimer = null;
  let saveDebounceTimer = null;

  // גרירת קנבס (Pan)
  let panState = { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 };

  // מצב חלונית הצד המובנית לקריאת מקורות
  const readerState = {
    open: false,
    currentSource: null,
    startLine: 0,
    endLine: 0,
    history: [],
    resizing: false
  };

  // מצב מדריך צעד-אחר-צעד
  const tourState = {
    active: false,
    stepIndex: 0
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getActiveChart() {
    if (!workspace.charts.length) {
      const fresh = Data.createBlankSugya('סוגיה ראשונה');
      workspace.charts.push(fresh);
      workspace.activeChartId = fresh.id;
      return fresh;
    }
    let found = workspace.charts.find(function (c) { return c.id === workspace.activeChartId; });
    if (!found) {
      found = workspace.charts[0];
      workspace.activeChartId = found.id;
    }
    return found;
  }

  // --- שמירה ---
  function persistWorkspaceNow() {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    Bridge.storageSet(STORAGE_KEY, workspace);
  }

  function persistWorkspaceDebounced() {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(function () {
      saveDebounceTimer = null;
      Bridge.storageSet(STORAGE_KEY, workspace);
    }, 320);
  }

  // --- Undo / Redo ---
  function resetHistory() {
    undoStack = [];
    redoStack = [];
    textUndoSnapshotPending = true;
    updateHistoryButtons();
  }

  function pushUndoSnapshot() {
    const chart = getActiveChart();
    undoStack.push({
      title: chart.title,
      nodes: Data.deepClone(chart.nodes)
    });
    if (undoStack.length > MAX_HISTORY) {
      undoStack.shift();
    }
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function performUndo() {
    if (undoStack.length === 0) return;
    const chart = getActiveChart();
    redoStack.push({
      title: chart.title,
      nodes: Data.deepClone(chart.nodes)
    });
    const prev = undoStack.pop();
    chart.title = prev.title;
    chart.nodes = prev.nodes;
    chart.updatedAt = Date.now();
    textUndoSnapshotPending = true;
    updateHistoryButtons();
    persistWorkspaceNow();
    renderAll();
    Bridge.notifyMessage('הפעולה בוטלה');
  }

  function performRedo() {
    if (redoStack.length === 0) return;
    const chart = getActiveChart();
    undoStack.push({
      title: chart.title,
      nodes: Data.deepClone(chart.nodes)
    });
    const next = redoStack.pop();
    chart.title = next.title;
    chart.nodes = next.nodes;
    chart.updatedAt = Date.now();
    textUndoSnapshotPending = true;
    updateHistoryButtons();
    persistWorkspaceNow();
    renderAll();
    Bridge.notifyMessage('הפעולה שוחזרה');
  }

  // --- החלת הגדרות תצוגה ---
  function applyVisualSettings() {
    const s = workspace.settings;

    document.body.classList.toggle('palette-otzaria', s.colorPalette === 'otzaria');
    document.body.classList.toggle('palette-colorful', s.colorPalette !== 'otzaria');

    document.body.classList.toggle('card-style-modern', s.cardStyle !== 'classic');
    document.body.classList.toggle('card-style-classic', s.cardStyle === 'classic');

    document.body.classList.remove('card-width-compact', 'card-width-normal', 'card-width-wide');
    document.body.classList.add('card-width-' + (s.cardWidth || 'normal'));

    document.body.classList.toggle('content-font-book', s.contentFont === 'book');
    document.body.classList.toggle('content-font-ui', s.contentFont !== 'book');

    const viewport = document.getElementById('canvasViewport');
    if (viewport) {
      viewport.classList.toggle('show-dots', s.showDots !== false);
    }

    const activeDot = document.getElementById('settingsActiveDot');
    if (activeDot) {
      activeDot.classList.toggle('hidden', s.velachenMode === 'none');
    }

    const readerSize = Math.min(30, Math.max(14, Number(s.readerFontSize) || 19));
    document.documentElement.style.setProperty('--font-size-reader', readerSize + 'px');
  }

  function shouldShowVelachen(typeId) {
    const s = workspace.settings;
    if (s.velachenMode === 'all') return true;
    if (s.velachenMode === 'single' && s.velachenSingleType === typeId) return true;
    return false;
  }

  function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = Math.max(54, el.scrollHeight) + 'px';
  }

  // ============================================================================
  // חלונית הצד המובנית לקריאת מקורות (סגירה קלה + החלפה חלקה בין מקורות)
  // ============================================================================

  function updateReaderHistoryButton() {
    const backBtn = document.getElementById('readerHistoryBackBtn');
    if (backBtn) {
      backBtn.disabled = readerState.history.length === 0;
    }
  }

  function closeSourceReaderPane() {
    readerState.open = false;
    document.getElementById('sourceReaderPane').classList.add('hidden');
    document.getElementById('readerResizer').classList.add('hidden');
  }

  async function renderReaderPassage() {
    const titleEl = document.getElementById('readerPaneTitle');
    const subEl = document.getElementById('readerPaneSub');
    const contentEl = document.getElementById('readerPaneContent');
    const bodyEl = document.getElementById('readerPaneBody');
    const footerEl = document.getElementById('readerPaneFooter');
    const prevBtn = document.getElementById('readerPrevChunkBtn');
    const rangeLabel = document.getElementById('readerRangeLabel');

    const src = readerState.currentSource;
    if (!src) return;

    const displayTitle = src.reference || src.title || src.bookId || 'מקור';
    titleEl.textContent = displayTitle;
    subEl.textContent = src.title && src.title !== displayTitle ? src.title : 'חלונית קריאה מובנית';
    contentEl.innerHTML = '<div class="reader-pane-notice">טוען את טקסט המקור...</div>';
    footerEl.classList.add('hidden');

    const reqSource = src;
    const reqStart = readerState.startLine;

    const result = await Bridge.loadBookPassage(src, reqStart, READER_CHUNK_LINES);
    // אם המשתמש כבר החליף מקור בזמן הטעינה, התעלם מתוצאה ישנה
    if (!readerState.open || readerState.currentSource !== reqSource || readerState.startLine !== reqStart) {
      return;
    }

    if (result.resolved) {
      readerState.currentSource = result.resolved;
      const resolvedTitle = result.resolved.reference || result.resolved.title || result.resolved.bookId;
      titleEl.textContent = resolvedTitle;
      subEl.textContent = result.resolved.title && result.resolved.title !== resolvedTitle
        ? result.resolved.title
        : 'חלונית קריאה מובנית';
    }

    if (result.ok) {
      readerState.startLine = result.startLine;
      readerState.endLine = result.endLine;
      contentEl.innerHTML = result.html;
      footerEl.classList.remove('hidden');
      prevBtn.disabled = readerState.startLine <= 0;
      rangeLabel.textContent = 'שורות ' + (readerState.startLine + 1) + '–' + (readerState.endLine + 1);
      bodyEl.scrollTop = 0;
    } else {
      contentEl.innerHTML = '';
      const notice = document.createElement('div');
      notice.className = 'reader-pane-notice';
      const msgP = document.createElement('p');
      msgP.textContent = result.message || 'לא ניתן להציג את המקור בחלונית הצד.';
      notice.appendChild(msgP);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn-primary';
      openBtn.textContent = 'פתח בכרטיסייה באוצריא';
      openBtn.addEventListener('click', function () {
        Bridge.openOtzariaTab(readerState.currentSource);
      });
      notice.appendChild(openBtn);
      contentEl.appendChild(notice);
    }
  }

  async function openSourceInSidePane(source, pushHistory) {
    if (!source) return;

    if (workspace.settings.openInSidePane === false) {
      if (!Bridge.state.inOtzaria) {
        Bridge.notifyMessage('פתיחת כרטיסיית ספר זמינה בתוך תוכנת אוצריא');
        return;
      }
      const ok = await Bridge.openOtzariaTab(source);
      if (!ok) {
        Bridge.notifyError('לא ניתן לפתוח את המקור באוצריא');
      }
      return;
    }

    if (pushHistory !== false && readerState.open && readerState.currentSource) {
      readerState.history.push({
        source: Data.deepClone(readerState.currentSource),
        startLine: readerState.startLine
      });
      if (readerState.history.length > 20) readerState.history.shift();
    }

    readerState.open = true;
    readerState.currentSource = Data.deepClone(source);
    readerState.startLine = typeof source.index === 'number' && source.index >= 0 ? source.index : null;

    document.getElementById('sourceReaderPane').classList.remove('hidden');
    document.getElementById('readerResizer').classList.remove('hidden');
    updateReaderHistoryButton();

    await renderReaderPassage();
  }

  // ============================================================================
  // בניית כרטיס שלב בודד וענפיו
  // ============================================================================

  function createNodeElement(node, siblingsList, siblingIndex, isLastRoot) {
    const meta = Data.getStepMeta(node.type);
    const showVelachen = shouldShowVelachen(node.type);
    const velachenLabel = (workspace.settings.velachenText || 'ולכן').trim() || 'ולכן';
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isDimmed = activeFilterType && activeFilterType !== node.type;
    const isHighlighted = activeFilterType && activeFilterType === node.type;

    const column = document.createElement('div');
    column.className = 'node-column';

    const frame = document.createElement('div');
    frame.className = 'step-card-frame step-type-' + meta.id;

    const card = document.createElement('div');
    card.className = 'step-card' +
      (isDimmed ? ' is-dimmed' : '') +
      (isHighlighted ? ' is-highlighted' : '');
    card.dataset.nodeId = node.id;

    // 1. באנר כותרת "ולכן"
    if (showVelachen) {
      const banner = document.createElement('div');
      banner.className = 'velachen-banner';
      banner.innerHTML =
        '<span class="velachen-star" aria-hidden="true">✦</span>' +
        '<span class="velachen-text">' + escapeHtml(velachenLabel) + '</span>' +
        '<span class="velachen-star" aria-hidden="true">✦</span>';
      card.appendChild(banner);
    }

    // 2. ראש הכרטיס
    const header = document.createElement('div');
    header.className = 'card-header';

    const badgeBtn = document.createElement('button');
    badgeBtn.type = 'button';
    badgeBtn.className = 'step-badge-btn';
    badgeBtn.title = 'לחץ כדי להחליף את סוג השלב';
    badgeBtn.innerHTML = meta.icon + '<span>' + meta.num + '. ' + escapeHtml(meta.label) + '</span>';
    badgeBtn.addEventListener('click', function () {
      openStepPicker({
        mode: 'change',
        nodeId: node.id,
        title: 'החלפת סוג שלב',
        subtitle: 'בחר סוג שלב חדש עבור חלונית זו (התוכן והענפים נשמרים)'
      });
    });

    const actions = document.createElement('div');
    actions.className = 'card-actions no-print';

    // קישור מקור באוצריא
    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'card-action-btn js-link-source-btn' + (node.source ? ' has-source' : '');
    linkBtn.title = node.source ? 'ערוך קישור מקור באוצריא' : 'קשר למקור באוצריא';
    linkBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path stroke-linecap="round" stroke-linejoin="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
    linkBtn.addEventListener('click', function () {
      openSourceModal(node.id);
    });
    actions.appendChild(linkBtn);

    // הזזת סדר בין אחים
    if (Array.isArray(siblingsList) && siblingsList.length > 1) {
      if (siblingIndex > 0) {
        const moveRightBtn = document.createElement('button');
        moveRightBtn.type = 'button';
        moveRightBtn.className = 'card-action-btn';
        moveRightBtn.title = 'הזז ימינה';
        moveRightBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';
        moveRightBtn.addEventListener('click', function () {
          const chart = getActiveChart();
          pushUndoSnapshot();
          Data.moveNodeSibling(chart.nodes, node.id, -1);
          chart.updatedAt = Date.now();
          persistWorkspaceNow();
          renderTree();
        });
        actions.appendChild(moveRightBtn);
      }
      if (siblingIndex < siblingsList.length - 1) {
        const moveLeftBtn = document.createElement('button');
        moveLeftBtn.type = 'button';
        moveLeftBtn.className = 'card-action-btn';
        moveLeftBtn.title = 'הזז שמאלה';
        moveLeftBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>';
        moveLeftBtn.addEventListener('click', function () {
          const chart = getActiveChart();
          pushUndoSnapshot();
          Data.moveNodeSibling(chart.nodes, node.id, 1);
          chart.updatedAt = Date.now();
          persistWorkspaceNow();
          renderTree();
        });
        actions.appendChild(moveLeftBtn);
      }
    }

    // קיפול/פתיחת ענפים
    if (hasChildren) {
      const collapseBtn = document.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.className = 'card-action-btn';
      collapseBtn.title = node.collapsed ? 'פתח ענפים מוסתרים' : 'קפל ענפים';
      collapseBtn.innerHTML = node.collapsed
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>';
      collapseBtn.addEventListener('click', function () {
        node.collapsed = !node.collapsed;
        persistWorkspaceNow();
        renderTree();
      });
      actions.appendChild(collapseBtn);
    }

    // מחיקת שלב
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'card-action-btn danger';
    deleteBtn.title = 'מחק שלב זה';
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
    deleteBtn.addEventListener('click', async function () {
      const descCount = Data.countDescendants(node);
      const hasContent = (node.text && node.text.trim()) || (node.subtitle && node.subtitle.trim());
      if (descCount > 0 || hasContent) {
        const msg = descCount > 0
          ? 'האם למחוק את השלב "' + meta.label + '" ואת ' + descCount + ' השלבים המסתעפים ממנו?'
          : 'האם למחוק את השלב "' + meta.label + '"?';
        const ok = await Bridge.confirmAction('מחיקת שלב', msg);
        if (!ok) return;
      }
      const chart = getActiveChart();
      pushUndoSnapshot();
      Data.deleteNodeById(chart.nodes, node.id);
      chart.updatedAt = Date.now();
      persistWorkspaceNow();
      renderAll();
      Bridge.notifyMessage('השלב נמחק');
    });
    actions.appendChild(deleteBtn);

    header.appendChild(badgeBtn);
    header.appendChild(actions);
    card.appendChild(header);

    // 3. גוף החלונית
    const body = document.createElement('div');
    body.className = 'card-body';

    const subtitleInput = document.createElement('input');
    subtitleInput.type = 'text';
    subtitleInput.className = 'card-subtitle-input';
    subtitleInput.value = node.subtitle || '';
    subtitleInput.placeholder = meta.subtitlePlaceholder;
    subtitleInput.addEventListener('focus', function () {
      textUndoSnapshotPending = true;
    });
    subtitleInput.addEventListener('input', function (e) {
      if (textUndoSnapshotPending) {
        pushUndoSnapshot();
        textUndoSnapshotPending = false;
      }
      node.subtitle = e.target.value;
      getActiveChart().updatedAt = Date.now();
      persistWorkspaceDebounced();
    });
    body.appendChild(subtitleInput);

    // תגית מקור מקושר מאוצריא (פותחת בחלונית הצד המובנית!)
    if (node.source) {
      const sourceRow = document.createElement('div');
      sourceRow.className = 'source-chip-row';

      const sourceChip = document.createElement('button');
      sourceChip.type = 'button';
      sourceChip.className = 'source-chip';
      sourceChip.title = 'לחץ לפתיחת המקור בחלונית הצד';
      sourceChip.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path stroke-linecap="round" stroke-linejoin="round" d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>' +
        '<span class="source-chip-text">' + escapeHtml(node.source.reference || node.source.title || node.source.bookId) + '</span>';
      sourceChip.addEventListener('click', function () {
        openSourceInSidePane(node.source, true);
      });

      const removeSourceBtn = document.createElement('button');
      removeSourceBtn.type = 'button';
      removeSourceBtn.className = 'source-chip-remove no-print';
      removeSourceBtn.title = 'הסר קישור למקור';
      removeSourceBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>';
      removeSourceBtn.addEventListener('click', function () {
        pushUndoSnapshot();
        delete node.source;
        getActiveChart().updatedAt = Date.now();
        persistWorkspaceNow();
        renderTree();
      });

      sourceRow.appendChild(sourceChip);
      sourceRow.appendChild(removeSourceBtn);
      body.appendChild(sourceRow);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'card-textarea';
    textarea.rows = 2;
    textarea.value = node.text || '';
    textarea.placeholder = meta.placeholder;
    textarea.addEventListener('focus', function () {
      textUndoSnapshotPending = true;
    });
    textarea.addEventListener('input', function (e) {
      if (textUndoSnapshotPending) {
        pushUndoSnapshot();
        textUndoSnapshotPending = false;
      }
      node.text = e.target.value;
      autoResizeTextarea(e.target);
      getActiveChart().updatedAt = Date.now();
      persistWorkspaceDebounced();
    });
    setTimeout(function () { autoResizeTextarea(textarea); }, 0);
    body.appendChild(textarea);

    card.appendChild(body);
    frame.appendChild(card);

    if (isLastRoot) {
      const anchor = document.createElement('div');
      anchor.className = 'root-card-anchor';
      anchor.appendChild(frame);

      const addInlineWrap = document.createElement('div');
      addInlineWrap.className = 'add-root-inline-wrap no-print';

      const addInlineBtn = document.createElement('button');
      addInlineBtn.id = 'addRootInlineBtn';
      addInlineBtn.type = 'button';
      addInlineBtn.className = 'add-root-inline-btn';
      addInlineBtn.title = 'הוסף שלב ראשי נוסף לראש התרשים';
      addInlineBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path stroke-linecap="round" d="M12 4v16m8-8H4"/></svg>' +
        '<span>הוסף שלב</span>';
      addInlineBtn.addEventListener('click', function () {
        openStepPicker({
          mode: 'add',
          parentId: null,
          title: 'בחר סוג שלב להוספה',
          subtitle: 'הוספת שלב ראשי חדש ליד השלב הראשון בתרשים'
        });
      });

      addInlineWrap.appendChild(addInlineBtn);
      anchor.appendChild(addInlineWrap);
      column.appendChild(anchor);
    } else {
      column.appendChild(frame);
    }

    // 4. כפתור פלוס (+) לפתיחה מחדש של כל 6 האפשרויות מכל שלב
    const addWrap = document.createElement('div');
    addWrap.className = 'add-child-wrap no-print';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-child-btn';
    addBtn.title = 'הוסף שלב המשך (פתיחה מחדש של כל 6 האפשרויות)';
    addBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" d="M12 4v16m8-8H4"/></svg>' +
      '<span>הוסף המשך</span>';
    addBtn.addEventListener('click', function () {
      openStepPicker({
        mode: 'add',
        parentId: node.id,
        title: 'בחר סוג שלב להוספה',
        subtitle: 'הסתעפות מתוך: ' + meta.num + '. ' + meta.label
      });
    });

    addWrap.appendChild(addBtn);
    column.appendChild(addWrap);

    // 5. ילדים או מצב מקופל
    if (hasChildren) {
      if (node.collapsed) {
        const count = Data.countDescendants(node);
        const collapsedBtn = document.createElement('button');
        collapsedBtn.type = 'button';
        collapsedBtn.className = 'collapsed-badge';
        collapsedBtn.textContent = '+ ' + count + ' שלבים מוסתרים';
        collapsedBtn.addEventListener('click', function () {
          node.collapsed = false;
          persistWorkspaceNow();
          renderTree();
        });
        column.appendChild(collapsedBtn);
      } else {
        const parentLine = document.createElement('div');
        parentLine.className = 'parent-connector';
        column.appendChild(parentLine);

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';

        node.children.forEach(function (child, idx) {
          const childWrap = document.createElement('div');
          childWrap.className = 'tree-child-wrapper';
          childWrap.appendChild(createNodeElement(child, node.children, idx));
          childrenContainer.appendChild(childWrap);
        });

        column.appendChild(childrenContainer);
      }
    }

    return column;
  }

  // --- מקרא 6 שלבים ---
  function renderLegend() {
    const bar = document.getElementById('legendBar');
    if (!bar) return;
    const chart = getActiveChart();
    const counts = Data.countByType(chart.nodes);

    bar.innerHTML = '';
    Data.STEP_TYPES.forEach(function (step) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'legend-pill' + (activeFilterType === step.id ? ' is-filtered' : '');
      btn.title = activeFilterType === step.id ? 'לחץ להסרת הדגשה' : 'לחץ להדגשת כל שלבי "' + step.label + '"';
      const cnt = counts[step.id] || 0;
      btn.innerHTML =
        '<span class="legend-dot dot-' + step.id + '"></span>' +
        '<span>' + step.num + '. ' + escapeHtml(step.label) + '</span>' +
        (cnt > 0 ? '<span class="legend-count">(' + cnt + ')</span>' : '');
      btn.addEventListener('click', function () {
        activeFilterType = (activeFilterType === step.id) ? null : step.id;
        renderLegend();
        renderTree();
      });
      bar.appendChild(btn);
    });
  }

  // --- כותרת ומונים ---
  function renderHeaderMeta() {
    const chart = getActiveChart();
    const titleInput = document.getElementById('sugyaTitleInput');
    if (titleInput && document.activeElement !== titleInput) {
      titleInput.value = chart.title || '';
    }
    const chipLabel = document.getElementById('sugyaChipLabel');
    if (chipLabel) chipLabel.textContent = chart.title || 'סוגיה ללא שם';

    const countBadge = document.getElementById('sugyaCountBadge');
    if (countBadge) countBadge.textContent = String(workspace.charts.length);

    const printTitle = document.getElementById('printTitle');
    if (printTitle) printTitle.textContent = chart.title || 'מבנה הסוגיא';
  }

  // --- רינדור התרשים המלא + כפתור "הוסף שלב" ליד השלב הראשון ---
  function renderTree(focusNodeId) {
    const rootEl = document.getElementById('treeRoot');
    if (!rootEl) return;
    const chart = getActiveChart();
    rootEl.innerHTML = '';

    if (!chart.nodes || chart.nodes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML =
        '<div class="empty-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
            '<rect x="8" y="3" width="8" height="4" rx="1"/>' +
            '<rect x="2" y="17" width="7" height="4" rx="1"/>' +
            '<rect x="15" y="17" width="7" height="4" rx="1"/>' +
            '<path stroke-linecap="round" d="M12 7v4M5.5 17v-3a2 2 0 012-2h9a2 2 0 012 2v3"/>' +
          '</svg>' +
        '</div>' +
        '<h2 class="empty-title">התרשים מוכן להתחלה</h2>' +
        '<p class="empty-desc">הוסף את השלב הראשון בסוגיה (יסוד - מקור, דעות, ראיות ועוד). מכל שלב ניתן לפתוח מחדש את כל 6 האפשרויות ולהסתעף בחופשיות.</p>' +
        '<div class="empty-actions">' +
          '<button id="emptyAddBtn" class="btn-primary" type="button">+ הוסף שלב ראשון</button>' +
          '<button id="emptyDemoBtn" class="btn-secondary" type="button">טען דוגמת "זה נהנה וזה לא חסר"</button>' +
        '</div>';
      rootEl.appendChild(empty);

      document.getElementById('emptyAddBtn').addEventListener('click', function () {
        openStepPicker({
          mode: 'add',
          parentId: null,
          title: 'בחר את השלב הראשון בתרשים',
          subtitle: 'מומלץ להתחיל ב-"1. יסוד - מקור", אך ניתן להתחיל בכל שלב'
        });
      });
      document.getElementById('emptyDemoBtn').addEventListener('click', loadDemoIntoCurrentChart);
      return;
    }

    chart.nodes.forEach(function (rootNode, idx) {
      const isLastRoot = (idx === chart.nodes.length - 1);
      rootEl.appendChild(createNodeElement(rootNode, chart.nodes, idx, isLastRoot));
    });

    if (focusNodeId) {
      setTimeout(function () {
        const card = rootEl.querySelector('[data-node-id="' + focusNodeId + '"]');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          const ta = card.querySelector('textarea');
          if (ta) ta.focus();
        }
      }, 40);
    }
  }

  function renderAll(focusNodeId) {
    applyVisualSettings();
    renderHeaderMeta();
    renderLegend();
    renderTree(focusNodeId);
    updateHistoryButtons();
  }

  // --- מודאל בחירת שלב ---
  function openStepPicker(opts) {
    pickerState = {
      mode: opts.mode || 'add',
      parentId: opts.parentId || null,
      nodeId: opts.nodeId || null
    };
    document.getElementById('pickerTitle').textContent = opts.title || 'בחר סוג שלב להוספה';
    document.getElementById('pickerSubtitle').textContent = opts.subtitle || 'ניתן לפתוח מחדש את כל 6 האפשרויות מכל שלב';

    const grid = document.getElementById('stepOptionsGrid');
    grid.innerHTML = '';

    Data.STEP_TYPES.forEach(function (step) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'step-option-btn step-type-' + step.id;
      btn.innerHTML =
        '<span class="step-option-icon">' + step.icon + '</span>' +
        '<div>' +
          '<div class="step-option-title">' + step.num + '. ' + escapeHtml(step.label) + '</div>' +
          '<div class="step-option-hint">' + (pickerState.mode === 'change' ? 'החלף לסוג זה' : 'מקש ' + step.num + ' · לחץ להוספה') + '</div>' +
        '</div>';
      btn.addEventListener('click', function () {
        selectStepTypeFromPicker(step.id);
      });
      grid.appendChild(btn);
    });

    document.getElementById('stepPickerModal').classList.add('open');
  }

  function closeStepPicker() {
    document.getElementById('stepPickerModal').classList.remove('open');
  }

  function selectStepTypeFromPicker(typeId) {
    const chart = getActiveChart();
    const meta = Data.getStepMeta(typeId);

    if (pickerState.mode === 'change' && pickerState.nodeId) {
      const target = Data.findNodeById(chart.nodes, pickerState.nodeId);
      if (target && target.type !== typeId) {
        pushUndoSnapshot();
        target.type = typeId;
        chart.updatedAt = Date.now();
        persistWorkspaceNow();
        renderAll();
        Bridge.notifyMessage('סוג השלב שונה ל: ' + meta.label);
      }
      closeStepPicker();
      return;
    }

    const newNode = {
      id: Data.generateId('node'),
      type: typeId,
      subtitle: '',
      text: '',
      collapsed: false,
      children: []
    };

    pushUndoSnapshot();
    if (!pickerState.parentId) {
      chart.nodes.push(newNode);
    } else {
      const parent = Data.findNodeById(chart.nodes, pickerState.parentId);
      if (parent) {
        parent.collapsed = false;
        parent.children.push(newNode);
      }
    }
    chart.updatedAt = Date.now();
    closeStepPicker();
    persistWorkspaceNow();
    renderAll(newNode.id);
  }

  // --- פאנל הגדרות צף ---
  function closeAllOverlays() {
    document.getElementById('overlayScrim').classList.remove('open');
    document.getElementById('settingsPanel').classList.remove('open');
    document.getElementById('sugyotPanel').classList.remove('open');
  }

  function buildSegmentedControl(containerId, items, activeId, onChange) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    items.forEach(function (item) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.label;
      if (item.id === activeId) btn.className = 'active';
      btn.addEventListener('click', function () {
        onChange(item.id);
      });
      el.appendChild(btn);
    });
  }

  function syncSwitch(id, isOn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('on', !!isOn);
    el.setAttribute('aria-checked', isOn ? 'true' : 'false');
  }

  function renderSettingsPanel() {
    const s = workspace.settings;

    buildSegmentedControl(
      'segVelachenMode',
      [
        { id: 'none', label: 'ללא' },
        { id: 'all', label: 'בכל החלוניות' },
        { id: 'single', label: 'סוג אחד' }
      ],
      s.velachenMode,
      function (val) {
        s.velachenMode = val;
        persistWorkspaceNow();
        renderSettingsPanel();
        renderAll();
      }
    );

    const singleRow = document.getElementById('singleTypeRow');
    singleRow.classList.toggle('hidden', s.velachenMode !== 'single');

    const singleGrid = document.getElementById('singleTypeButtons');
    singleGrid.innerHTML = '';
    Data.STEP_TYPES.forEach(function (step) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'single-type-btn' + (s.velachenSingleType === step.id ? ' selected' : '');
      btn.innerHTML = '<span class="legend-dot dot-' + step.id + '"></span><span>' + step.num + '. ' + escapeHtml(step.label) + '</span>';
      btn.addEventListener('click', function () {
        s.velachenSingleType = step.id;
        persistWorkspaceNow();
        renderSettingsPanel();
        renderTree();
      });
      singleGrid.appendChild(btn);
    });

    const textInput = document.getElementById('velachenTextInput');
    if (document.activeElement !== textInput) {
      textInput.value = s.velachenText || 'ולכן';
    }
    document.getElementById('velachenPreviewText').textContent = (s.velachenText || 'ולכן').trim() || 'ולכן';

    // בחירת ערכת צבעים: צבעוני או צבעי אוצריא עדינים וחיוורים
    buildSegmentedControl(
      'segColorPalette',
      [
        { id: 'colorful', label: 'צבעוני' },
        { id: 'otzaria', label: 'צבעי אוצריא (עדין)' }
      ],
      s.colorPalette || 'colorful',
      function (val) {
        s.colorPalette = val;
        persistWorkspaceNow();
        renderSettingsPanel();
        applyVisualSettings();
      }
    );

    buildSegmentedControl(
      'segCardStyle',
      [
        { id: 'modern', label: 'מודרני' },
        { id: 'classic', label: 'קלאסי (שכבות)' }
      ],
      s.cardStyle,
      function (val) {
        s.cardStyle = val;
        persistWorkspaceNow();
        renderSettingsPanel();
        applyVisualSettings();
      }
    );

    buildSegmentedControl(
      'segCardWidth',
      [
        { id: 'compact', label: 'צר' },
        { id: 'normal', label: 'רגיל' },
        { id: 'wide', label: 'רחב' }
      ],
      s.cardWidth,
      function (val) {
        s.cardWidth = val;
        persistWorkspaceNow();
        renderSettingsPanel();
        applyVisualSettings();
      }
    );

    buildSegmentedControl(
      'segContentFont',
      [
        { id: 'ui', label: 'ממשק' },
        { id: 'book', label: 'ספר' }
      ],
      s.contentFont,
      function (val) {
        s.contentFont = val;
        persistWorkspaceNow();
        renderSettingsPanel();
        applyVisualSettings();
      }
    );

    syncSwitch('switchShowDots', s.showDots !== false);
    syncSwitch('switchSidePane', s.openInSidePane !== false);

    buildSegmentedControl(
      'segPdfOrientation',
      [
        { id: 'auto', label: 'אוטומטי' },
        { id: 'landscape', label: 'לרוחב' },
        { id: 'portrait', label: 'לאורך' }
      ],
      s.pdfOrientation || 'auto',
      function (val) {
        s.pdfOrientation = val;
        persistWorkspaceNow();
        renderSettingsPanel();
      }
    );
  }

  function openSettingsPanel() {
    closeAllOverlays();
    renderSettingsPanel();
    document.getElementById('overlayScrim').classList.add('open');
    document.getElementById('settingsPanel').classList.add('open');
  }

  // --- פאנל הסוגיות שלי ---
  function formatDateShort(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
    } catch (_) {
      return '';
    }
  }

  function renderSugyotDrawer() {
    const container = document.getElementById('sugyaListContainer');
    const searchVal = (document.getElementById('sugyaSearchInput').value || '').trim().toLowerCase();
    container.innerHTML = '';

    const active = getActiveChart();
    const list = workspace.charts
      .slice()
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })
      .filter(function (c) {
        if (!searchVal) return true;
        return (c.title || '').toLowerCase().indexOf(searchVal) !== -1;
      });

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'source-empty-msg';
      empty.textContent = 'לא נמצאו סוגיות תואמות';
      container.appendChild(empty);
      return;
    }

    list.forEach(function (chart) {
      const item = document.createElement('div');
      item.className = 'sugya-item' + (chart.id === active.id ? ' active' : '');

      const info = document.createElement('div');
      info.className = 'sugya-item-info';
      const stepCount = Data.countAllNodes(chart.nodes);
      const dateStr = formatDateShort(chart.updatedAt);
      info.innerHTML =
        '<div class="sugya-item-title">' + escapeHtml(chart.title || 'סוגיה ללא שם') + '</div>' +
        '<div class="sugya-item-meta">' + stepCount + ' שלבים' + (dateStr ? ' · עודכן ' + escapeHtml(dateStr) : '') + '</div>';

      info.addEventListener('click', function () {
        if (workspace.activeChartId !== chart.id) {
          workspace.activeChartId = chart.id;
          activeFilterType = null;
          currentZoom = 1;
          applyZoom();
          resetHistory();
          persistWorkspaceNow();
          renderAll();
        }
        closeAllOverlays();
      });

      const actions = document.createElement('div');
      actions.className = 'sugya-item-actions';

      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'card-action-btn';
      dupBtn.title = 'שכפל סוגיה';
      dupBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      dupBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const copy = Data.deepClone(chart);
        copy.id = Data.generateId('sugya');
        copy.title = (chart.title || 'סוגיה') + ' (עותק)';
        copy.createdAt = Date.now();
        copy.updatedAt = Date.now();
        workspace.charts.unshift(copy);
        workspace.activeChartId = copy.id;
        resetHistory();
        persistWorkspaceNow();
        renderAll();
        renderSugyotDrawer();
        Bridge.notifySuccess('הסוגיה שוכפלה');
      });
      actions.appendChild(dupBtn);

      if (workspace.charts.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'card-action-btn danger';
        delBtn.title = 'מחק סוגיה';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m1 0l-1 14a2 2 0 01-2 2H9a2 2 0 01-2-2L6 6"/></svg>';
        delBtn.addEventListener('click', async function (e) {
          e.stopPropagation();
          const ok = await Bridge.confirmAction('מחיקת סוגיה', 'האם למחוק לצמיתות את הסוגיה "' + (chart.title || 'ללא שם') + '"?');
          if (!ok) return;
          workspace.charts = workspace.charts.filter(function (c) { return c.id !== chart.id; });
          if (workspace.activeChartId === chart.id) {
            workspace.activeChartId = workspace.charts[0] ? workspace.charts[0].id : null;
            resetHistory();
          }
          persistWorkspaceNow();
          renderAll();
          renderSugyotDrawer();
          Bridge.notifyMessage('הסוגיה נמחקה');
        });
        actions.appendChild(delBtn);
      }

      item.appendChild(info);
      item.appendChild(actions);
      container.appendChild(item);
    });
  }

  function openSugyotPanel() {
    closeAllOverlays();
    renderSugyotDrawer();
    document.getElementById('overlayScrim').classList.add('open');
    document.getElementById('sugyotPanel').classList.add('open');
    setTimeout(function () {
      const inp = document.getElementById('sugyaSearchInput');
      if (inp) inp.focus();
    }, 80);
  }

  // --- מודאל קישור למקור באוצריא ---
  async function openSourceModal(nodeId) {
    sourceModalNodeId = nodeId;
    const chart = getActiveChart();
    const node = Data.findNodeById(chart.nodes, nodeId);
    if (!node) return;

    const modal = document.getElementById('sourceModal');
    const searchInput = document.getElementById('sourceSearchInput');
    const resultsEl = document.getElementById('sourceSearchResults');
    const openTabsSection = document.getElementById('openTabsSection');
    const openTabsEl = document.getElementById('openTabsResults');
    const unlinkBtn = document.getElementById('unlinkSourceBtn');

    unlinkBtn.classList.toggle('hidden', !node.source);
    searchInput.value = (node.source && node.source.reference) || node.subtitle || '';
    resultsEl.innerHTML = '';
    openTabsEl.innerHTML = '';
    modal.classList.add('open');
    searchInput.focus();

    if (!Bridge.state.inOtzaria) {
      openTabsSection.classList.add('hidden');
      resultsEl.innerHTML = '<div class="source-empty-msg">קישור וחיפוש מקורות ישיר זמין בעת הרצת התוסף בתוך תוכנת אוצריא.</div>';
      return;
    }

    openTabsSection.classList.remove('hidden');
    openTabsEl.innerHTML = '<div class="source-empty-msg">טוען ספרים פתוחים...</div>';

    const openBooks = await Bridge.getOpenReaderBooks();
    openTabsEl.innerHTML = '';
    if (openBooks.length === 0) {
      openTabsEl.innerHTML = '<div class="source-empty-msg">אין כרגע ספרי לימוד פתוחים בכרטיסיות אחרות באוצריא.</div>';
    } else {
      openBooks.forEach(function (item) {
        openTabsEl.appendChild(createSourceResultButton(item));
      });
    }

    if (searchInput.value.trim().length >= 2) {
      runSourceSearch(searchInput.value.trim());
    }
  }

  function createSourceResultButton(hit) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'source-result-btn';
    const refLabel = hit.reference || hit.title || hit.bookId;
    const sub = hit.bookPath || (hit.title && hit.title !== refLabel ? hit.title : '');
    btn.innerHTML =
      '<span class="source-result-ref">' + escapeHtml(refLabel) + '</span>' +
      (sub ? '<span class="source-result-path">' + escapeHtml(sub) + '</span>' : '');
    btn.addEventListener('click', function () {
      attachSourceToNode(hit);
    });
    return btn;
  }

  function attachSourceToNode(hit) {
    const chart = getActiveChart();
    const node = Data.findNodeById(chart.nodes, sourceModalNodeId);
    if (!node) return;
    pushUndoSnapshot();
    node.source = {
      id: hit.id != null ? hit.id : null,
      bookId: hit.bookId || hit.title,
      type: hit.type || 'text',
      title: hit.title || hit.bookId,
      reference: hit.reference || hit.title || hit.bookId,
      index: typeof hit.index === 'number' ? hit.index : 0,
      isPdf: !!hit.isPdf,
      isUserBook: !!hit.isUserBook
    };
    if (!node.subtitle || !node.subtitle.trim()) {
      node.subtitle = node.source.reference;
    }
    chart.updatedAt = Date.now();
    closeSourceModal();
    persistWorkspaceNow();
    renderTree();
    Bridge.notifySuccess('המקור קושר לשלב בהצלחה');
  }

  async function runSourceSearch(query) {
    const resultsEl = document.getElementById('sourceSearchResults');
    if (!Bridge.state.inOtzaria) return;
    if (!query || query.length < 2) {
      resultsEl.innerHTML = '<div class="source-empty-msg">הקלד לפחות 2 תווים לחיפוש מקור באוצריא (למשל: "בבא קמא כ")</div>';
      return;
    }
    resultsEl.innerHTML = '<div class="source-empty-msg">מחפש בספריית אוצריא...</div>';
    const hits = await Bridge.resolveRef(query, 12);
    resultsEl.innerHTML = '';
    if (!hits || hits.length === 0) {
      resultsEl.innerHTML = '<div class="source-empty-msg">לא נמצאו מקורות תואמים בספרייה.</div>';
      return;
    }
    hits.forEach(function (hit) {
      resultsEl.appendChild(createSourceResultButton(hit));
    });
  }

  function closeSourceModal() {
    document.getElementById('sourceModal').classList.remove('open');
    sourceModalNodeId = null;
  }

  // --- טעינת דוגמה מוכנה ---
  async function loadDemoIntoCurrentChart() {
    closeAllOverlays();
    const chart = getActiveChart();
    if (chart.nodes.length > 0) {
      const ok = await Bridge.confirmAction(
        'טעינת תרשים לדוגמה',
        'הסוגיה הנוכחית אינה ריקה. האם להוסיף את הדוגמה "זה נהנה וזה לא חסר" כסוגיה חדשה נפרדת?'
      );
      if (!ok) return;
      const demo = Data.createDemoSugya();
      workspace.charts.unshift(demo);
      workspace.activeChartId = demo.id;
      resetHistory();
      persistWorkspaceNow();
      renderAll();
      Bridge.notifySuccess('נוספה סוגיית דוגמה: זה נהנה וזה לא חסר');
      return;
    }

    const demo = Data.createDemoSugya();
    pushUndoSnapshot();
    chart.title = demo.title;
    chart.nodes = demo.nodes;
    chart.updatedAt = Date.now();
    persistWorkspaceNow();
    renderAll();
    Bridge.notifySuccess('נטענה דוגמה: זה נהנה וזה לא חסר (בבא קמא כ׳)');
  }

  // --- זום והתאמה למסך ---
  function applyZoom() {
    const wrapper = document.getElementById('zoomWrapper');
    if (wrapper) {
      wrapper.style.transform = 'scale(' + currentZoom + ')';
    }
    const resetBtn = document.getElementById('zoomResetBtn');
    if (resetBtn) {
      resetBtn.textContent = Math.round(currentZoom * 100) + '%';
    }
  }

  function setZoom(val) {
    currentZoom = Math.min(1.5, Math.max(0.4, Math.round(val * 100) / 100));
    applyZoom();
  }

  function fitToScreen() {
    const viewport = document.getElementById('canvasViewport');
    const treeRoot = document.getElementById('treeRoot');
    if (!viewport || !treeRoot) return;
    const prevZoom = currentZoom;
    currentZoom = 1;
    applyZoom();

    const treeRect = treeRoot.getBoundingClientRect();
    if (treeRect.width <= 0 || treeRect.height <= 0) {
      setZoom(prevZoom);
      return;
    }
    const availW = Math.max(200, viewport.clientWidth - 64);
    const availH = Math.max(200, viewport.clientHeight - 80);
    const scaleW = availW / treeRect.width;
    const scaleH = availH / treeRect.height;
    const best = Math.min(1, scaleW, scaleH);
    setZoom(Math.max(0.4, best));
    viewport.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }

  // --- ייצוא PDF והדפסה (קריאה ישירה מידית ממאזין הלחיצה לשמירת userActivation) ---
  function resolvePrintOrientation() {
    const pref = workspace.settings.pdfOrientation || 'auto';
    if (pref === 'landscape' || pref === 'portrait') return pref;
    const treeRoot = document.getElementById('treeRoot');
    if (treeRoot) {
      const rect = treeRoot.getBoundingClientRect();
      if (rect.width > rect.height * 1.05) return 'landscape';
      return 'portrait';
    }
    return 'landscape';
  }

  function handleExportPdfClick() {
    closeAllOverlays();
    const chart = getActiveChart();
    renderHeaderMeta();
    const orientation = resolvePrintOrientation();
    const safeName = (chart.title || 'מבנה_הסוגיא').replace(/[\\/:*?"<>|]+/g, '_');
    Bridge.exportPdf(safeName, orientation).then(function (res) {
      if (res && res.saved && !res.fallback) {
        Bridge.notifySuccess('התרשים יוצא ל-PDF: ' + (res.name || safeName + '.pdf'));
      } else if (res && res.error) {
        Bridge.notifyError(res.error);
      }
    });
  }

  function handlePrintClick() {
    closeAllOverlays();
    const chart = getActiveChart();
    renderHeaderMeta();
    const orientation = resolvePrintOrientation();
    Bridge.printChart(chart.title || 'מבנה הסוגיא', orientation);
  }

  // --- ייצוא וייבוא JSON ---
  async function handleExportCurrentJson() {
    const chart = getActiveChart();
    const payload = {
      format: 'otzaria-sugya-map',
      schemaVersion: 1,
      title: chart.title,
      nodes: chart.nodes,
      settings: workspace.settings
    };
    const safeName = (chart.title || 'sugya_chart').replace(/[\s\\/:*?"<>|]+/g, '_');
    const res = await Bridge.saveJsonFile(safeName, JSON.stringify(payload, null, 2));
    if (res && !res.cancelled) {
      Bridge.notifySuccess('קובץ הגיבוי נשמר בהצלחה');
    }
  }

  async function handleExportAllJson() {
    const payload = {
      format: 'otzaria-sugya-workspace',
      schemaVersion: 1,
      charts: workspace.charts,
      settings: workspace.settings
    };
    const res = await Bridge.saveJsonFile('כל_הסוגיות_גיבוי', JSON.stringify(payload, null, 2));
    if (res && !res.cancelled) {
      Bridge.notifySuccess('כל הסוגיות (' + workspace.charts.length + ') גובו לקובץ');
    }
  }

  function importParsedJsonText(rawText) {
    try {
      const parsed = JSON.parse(rawText);
      if (!parsed || typeof parsed !== 'object') {
        Bridge.notifyError('קובץ הגיבוי אינו תקין');
        return;
      }

      if (Array.isArray(parsed.charts) && parsed.charts.length > 0) {
        let added = 0;
        parsed.charts.forEach(function (c) {
          if (c && Array.isArray(c.nodes)) {
            workspace.charts.unshift({
              id: Data.generateId('sugya'),
              title: c.title || 'סוגיה מיובאת',
              createdAt: c.createdAt || Date.now(),
              updatedAt: Date.now(),
              nodes: c.nodes
            });
            added += 1;
          }
        });
        if (added > 0) {
          workspace.activeChartId = workspace.charts[0].id;
          resetHistory();
          persistWorkspaceNow();
          renderAll();
          Bridge.notifySuccess('יובאו בהצלחה ' + added + ' סוגיות');
          return;
        }
      }

      if (Array.isArray(parsed.nodes)) {
        const imported = {
          id: Data.generateId('sugya'),
          title: parsed.title || 'סוגיה מיובאת',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodes: parsed.nodes
        };
        workspace.charts.unshift(imported);
        workspace.activeChartId = imported.id;
        if (parsed.settings) {
          workspace.settings = Object.assign({}, workspace.settings, {
            velachenMode: parsed.settings.velachenMode || workspace.settings.velachenMode,
            velachenSingleType: parsed.settings.velachenSingleType || workspace.settings.velachenSingleType,
            velachenText: parsed.settings.velachenText || workspace.settings.velachenText
          });
        }
        resetHistory();
        persistWorkspaceNow();
        renderAll();
        Bridge.notifySuccess('הסוגיה "' + imported.title + '" יובאה בהצלחה');
        return;
      }

      Bridge.notifyError('מבנה הקובץ אינו מוכר');
    } catch (err) {
      console.error('Import JSON error:', err);
      Bridge.notifyError('שגיאה בקריאת קובץ ה-JSON');
    }
  }

  async function handleImportJsonClick() {
    const inputEl = document.getElementById('importJsonInput');
    const res = await Bridge.pickAndReadJsonFile(inputEl);
    if (!res || res.cancelled || res.delegatedToInput) return;
    if (res.error) {
      Bridge.notifyError(res.error);
      return;
    }
    if (typeof res.text === 'string') {
      importParsedJsonText(res.text);
    }
  }

  // --- קיפול / פתיחת כל הענפים ---
  function setAllCollapsed(nodes, collapsed, depth) {
    if (!Array.isArray(nodes)) return;
    nodes.forEach(function (n) {
      if (Array.isArray(n.children) && n.children.length > 0) {
        if (!collapsed || depth >= 1) {
          n.collapsed = collapsed;
        }
        setAllCollapsed(n.children, collapsed, depth + 1);
      }
    });
  }

  // ============================================================================
  // מדריך אינטראקטיבי שלב-אחר-שלב (Spotlight Guided Tour)
  // ============================================================================

  const TOUR_STEPS = [
    {
      selector: null,
      title: 'ברוכים הבאים ל"מבנה הסוגיא"!',
      text: 'כלי ויזואלי לבניית תרשים זרימה מסתעף של סוגיה — מושלם ללימוד בחברותא ולהצגת המהלך בבהירות. בואו נעבור יחד שלב אחר שלב (כחצי דקה) ונראה איך להשתמש בכל כפתור בפועל.'
    },
    {
      selector: '#openSugyotBtn',
      title: 'ניהול "הסוגיות שלי"',
      text: 'לחיצה על כפתור "הסוגיות שלי" פותחת את רשימת כל הסוגיות השמורות שלך. מכאן תוכל ליצור סוגיה חדשה, לעבור בין סוגיות שונות, לחפש, לשכפל או למחוק סוגיות.'
    },
    {
      selector: '#addRootInlineBtn, #emptyAddBtn',
      title: 'הוספת שלב ראשי ליד השלב הראשון',
      text: 'כאן, ממש ליד השלב הראשון בתרשים, תוכל להוסיף שלב ראשי נוסף (מתוך 6 השלבים: יסוד-מקור, דעות, ראיות, דחיה, תשובה ומסקנא).'
    },
    {
      selector: '.step-card',
      title: 'עריכת שלב והסתעפות מחדש לכל 6 האפשרויות',
      text: 'בכל חלונית כותבים כותרת משנה ותוכן חופשי. לחיצה על תגית השלב בראש החלונית מאפשרת להחליף את סוג השלב, וכפתור "+ הוסף המשך" שמתחת לחלונית פותח מחדש את כל 6 האפשרויות להסתעפות.'
    },
    {
      selector: '.source-chip, .js-link-source-btn',
      title: 'קישור וקריאת מקורות בחלונית צד מובנית',
      text: 'לחץ על אייקון הקישור בכל חלונית כדי לקשר דף גמרא או ספר מאוצריא. לחיצה על המקור המקושר תפתח אותו מיד בחלונית צד נוחה עם כפתור "סגור" מהיר — ולחיצה על מקור נוסף תחליף את התצוגה באותה חלונית!'
    },
    {
      selector: '#legendBar',
      title: 'מקרא השלבים והדגשה מהירה',
      text: 'בפס המקרא רואים במבט אחד כמה שלבים יש מכל סוג בסוגיה. לחיצה על אחד השלבים מדגישה בתרשים רק את החלוניות מאותו הסוג (ולחיצה חוזרת מבטלת).'
    },
    {
      selector: '#openSettingsBtn',
      title: 'הגדרות: כותרת "ולכן", צבעי אוצריא, דוגמה ו-PDF',
      text: 'בתפריט ההגדרות תוכל להפעיל כותרת מעוצבת "ולכן" בכל החלוניות או רק בסוג אחד, לעבור לצבעי אוצריא עדינים וחיוורים, להחליף לסגנון "משפחות" קלאסי, לטעון דוגמה מוכנה ולייצא ל-PDF.'
    }
  ];

  function findTourTarget(selector) {
    if (!selector) return null;
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return el;
  }

  function positionTourStep() {
    if (!tourState.active) return;
    const step = TOUR_STEPS[tourState.stepIndex];
    const spotlight = document.getElementById('tourSpotlight');
    const fullBackdrop = document.getElementById('tourBackdropFull');
    const popover = document.getElementById('tourPopover');

    const badge = document.getElementById('tourStepBadge');
    const titleEl = document.getElementById('tourTitle');
    const textEl = document.getElementById('tourText');
    const dotsEl = document.getElementById('tourDots');
    const prevBtn = document.getElementById('tourPrevBtn');
    const nextBtn = document.getElementById('tourNextBtn');

    badge.textContent = 'שלב ' + (tourState.stepIndex + 1) + ' מתוך ' + TOUR_STEPS.length;
    titleEl.textContent = step.title;
    textEl.textContent = step.text;

    prevBtn.disabled = tourState.stepIndex === 0;
    nextBtn.textContent = tourState.stepIndex === TOUR_STEPS.length - 1 ? 'סיום' : 'הבא';

    dotsEl.innerHTML = '';
    TOUR_STEPS.forEach(function (_, idx) {
      const d = document.createElement('span');
      d.className = 'tour-dot' + (idx === tourState.stepIndex ? ' active' : '');
      dotsEl.appendChild(d);
    });

    const target = findTourTarget(step.selector);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!target) {
      spotlight.classList.add('hidden');
      fullBackdrop.classList.remove('hidden');
      popover.style.top = '50%';
      popover.style.left = '50%';
      popover.style.transform = 'translate(-50%, -50%)';
      return;
    }

    target.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    const pad = 6;
    const sTop = Math.max(4, rect.top - pad);
    const sLeft = Math.max(4, rect.left - pad);
    const sWidth = Math.min(vw - sLeft - 4, rect.width + pad * 2);
    const sHeight = Math.min(vh - sTop - 4, rect.height + pad * 2);

    fullBackdrop.classList.add('hidden');
    spotlight.classList.remove('hidden');
    spotlight.style.top = sTop + 'px';
    spotlight.style.left = sLeft + 'px';
    spotlight.style.width = sWidth + 'px';
    spotlight.style.height = sHeight + 'px';

    // מיקום בועת ההסבר בלי לצאת מגבולות המסך
    popover.style.transform = 'none';
    const popRect = popover.getBoundingClientRect();
    const popW = popRect.width || 360;
    const popH = popRect.height || 210;

    let top = sTop + sHeight + 14;
    if (top + popH > vh - 12) {
      top = Math.max(12, sTop - popH - 14);
    }
    let left = sLeft + (sWidth / 2) - (popW / 2);
    left = Math.max(12, Math.min(vw - popW - 12, left));

    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
  }

  function startGuidedTour() {
    closeAllOverlays();
    closeStepPicker();
    closeSourceModal();
    closeAboutModal();
    closeMoreMenu();
    tourState.active = true;
    tourState.stepIndex = 0;
    document.getElementById('tourLayer').classList.remove('hidden');
    positionTourStep();
  }

  function endGuidedTour() {
    tourState.active = false;
    document.getElementById('tourLayer').classList.add('hidden');
    if (!workspace.settings.tourCompleted) {
      workspace.settings.tourCompleted = true;
      persistWorkspaceNow();
    }
  }

  // --- מודאל אודות ---
  function openAboutModal() {
    const verEl = document.getElementById('aboutVersionText');
    if (verEl) {
      verEl.textContent = 'גרסה ' + (Bridge.state.pluginVersion || '1.0.0') + ' · נוצר ע״י לב טוב · תוסף לאוצריא';
    }
    const shortcutsArea = document.getElementById('aboutShortcutsArea');
    const startBtn = document.getElementById('createStartShortcutBtn');
    if (Bridge.state.inOtzaria && Bridge.isDesktop()) {
      shortcutsArea.classList.remove('hidden');
      startBtn.classList.toggle('hidden', Bridge.state.platform !== 'windows');
    } else {
      shortcutsArea.classList.add('hidden');
    }
    document.getElementById('aboutModal').classList.add('open');
  }

  function closeAboutModal() {
    document.getElementById('aboutModal').classList.remove('open');
  }

  function closeMoreMenu() {
    document.getElementById('moreMenuPopover').classList.remove('open');
  }

  // --- טעינת מצב ראשוני ---
  async function loadWorkspace() {
    const saved = await Bridge.storageGet(STORAGE_KEY);
    if (saved && Array.isArray(saved.charts) && saved.charts.length > 0) {
      workspace = {
        schemaVersion: 1,
        activeChartId: saved.activeChartId || saved.charts[0].id,
        charts: saved.charts,
        settings: Object.assign({}, Data.DEFAULT_SETTINGS, saved.settings || {})
      };
    } else {
      const demo = Data.createDemoSugya();
      workspace = {
        schemaVersion: 1,
        activeChartId: demo.id,
        charts: [demo],
        settings: Object.assign({}, Data.DEFAULT_SETTINGS)
      };
      persistWorkspaceNow();
    }
  }

  // --- חיבור מאזינים ---
  function bindEvents() {
    // כותרת סוגיה
    const titleInput = document.getElementById('sugyaTitleInput');
    titleInput.addEventListener('input', function (e) {
      const chart = getActiveChart();
      chart.title = e.target.value;
      chart.updatedAt = Date.now();
      renderHeaderMeta();
      persistWorkspaceDebounced();
    });

    // Undo / Redo
    document.getElementById('undoBtn').addEventListener('click', performUndo);
    document.getElementById('redoBtn').addEventListener('click', performRedo);

    // זום
    document.getElementById('zoomInBtn').addEventListener('click', function () { setZoom(currentZoom + 0.1); });
    document.getElementById('zoomOutBtn').addEventListener('click', function () { setZoom(currentZoom - 0.1); });
    document.getElementById('zoomResetBtn').addEventListener('click', function () { setZoom(1); });
    document.getElementById('zoomFitBtn').addEventListener('click', fitToScreen);

    const viewport = document.getElementById('canvasViewport');
    viewport.addEventListener('wheel', function (e) {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        setZoom(currentZoom + delta);
      }
    }, { passive: false });

    // גרירת רקע הקנבס
    viewport.addEventListener('mousedown', function (e) {
      if (e.button !== 0 && e.button !== 1) return;
      if (e.target.closest('.step-card-frame, .add-root-inline-wrap, button, input, textarea, .empty-state')) return;
      panState.active = true;
      panState.startX = e.clientX;
      panState.startY = e.clientY;
      panState.scrollLeft = viewport.scrollLeft;
      panState.scrollTop = viewport.scrollTop;
      viewport.classList.add('is-panning');
    });

    window.addEventListener('mousemove', function (e) {
      if (panState.active) {
        viewport.scrollLeft = panState.scrollLeft - (e.clientX - panState.startX);
        viewport.scrollTop = panState.scrollTop - (e.clientY - panState.startY);
      }
      if (readerState.resizing) {
        const splitRect = document.querySelector('.workspace-split').getBoundingClientRect();
        // ב-RTL חלונית המקור ממוקמת בצד שמאל
        const newWidth = Math.max(280, Math.min(splitRect.width * 0.62, e.clientX - splitRect.left));
        document.documentElement.style.setProperty('--reader-pane-width', Math.round(newWidth) + 'px');
      }
    });

    window.addEventListener('mouseup', function () {
      if (panState.active) {
        panState.active = false;
        viewport.classList.remove('is-panning');
      }
      if (readerState.resizing) {
        readerState.resizing = false;
        document.getElementById('readerResizer').classList.remove('is-resizing');
      }
    });

    // ידית שינוי רוחב חלונית המקור
    const resizer = document.getElementById('readerResizer');
    resizer.addEventListener('mousedown', function (e) {
      e.preventDefault();
      readerState.resizing = true;
      resizer.classList.add('is-resizing');
    });

    // פקדי חלונית הצד המובנית לקריאת מקורות
    document.getElementById('readerCloseBtn').addEventListener('click', closeSourceReaderPane);
    document.getElementById('readerOpenTabBtn').addEventListener('click', function () {
      if (!Bridge.state.inOtzaria) {
        Bridge.notifyMessage('פתיחת כרטיסייה באוצריא זמינה בתוך התוכנה');
        return;
      }
      if (readerState.currentSource) {
        Bridge.openOtzariaTab(readerState.currentSource);
      }
    });
    document.getElementById('readerHistoryBackBtn').addEventListener('click', function () {
      if (readerState.history.length === 0) return;
      const prev = readerState.history.pop();
      readerState.currentSource = prev.source;
      readerState.startLine = prev.startLine;
      updateReaderHistoryButton();
      renderReaderPassage();
    });
    document.getElementById('readerFontDecBtn').addEventListener('click', function () {
      const next = Math.max(14, (Number(workspace.settings.readerFontSize) || 19) - 2);
      workspace.settings.readerFontSize = next;
      applyVisualSettings();
      persistWorkspaceDebounced();
    });
    document.getElementById('readerFontIncBtn').addEventListener('click', function () {
      const next = Math.min(30, (Number(workspace.settings.readerFontSize) || 19) + 2);
      workspace.settings.readerFontSize = next;
      applyVisualSettings();
      persistWorkspaceDebounced();
    });
    document.getElementById('readerPrevChunkBtn').addEventListener('click', function () {
      if (readerState.startLine <= 0) return;
      readerState.startLine = Math.max(0, readerState.startLine - READER_CHUNK_LINES);
      renderReaderPassage();
    });
    document.getElementById('readerNextChunkBtn').addEventListener('click', function () {
      readerState.startLine = (readerState.startLine || 0) + READER_CHUNK_LINES;
      renderReaderPassage();
    });

    // מדריך אינטראקטיבי
    document.getElementById('startTourBtn').addEventListener('click', startGuidedTour);
    document.getElementById('settingsStartTourBtn').addEventListener('click', startGuidedTour);
    document.getElementById('aboutStartTourBtn').addEventListener('click', startGuidedTour);
    document.getElementById('menuStartTour').addEventListener('click', startGuidedTour);
    document.getElementById('tourCloseBtn').addEventListener('click', endGuidedTour);
    document.getElementById('tourSkipBtn').addEventListener('click', endGuidedTour);
    document.getElementById('tourPrevBtn').addEventListener('click', function () {
      if (tourState.stepIndex > 0) {
        tourState.stepIndex -= 1;
        positionTourStep();
      }
    });
    document.getElementById('tourNextBtn').addEventListener('click', function () {
      if (tourState.stepIndex < TOUR_STEPS.length - 1) {
        tourState.stepIndex += 1;
        positionTourStep();
      } else {
        endGuidedTour();
        Bridge.notifySuccess('כל הכבוד! סיימת את מדריך השימוש');
      }
    });
    window.addEventListener('resize', function () {
      if (tourState.active) positionTourStep();
    });

    // פתיחת/סגירת פאנל הגדרות ופאנל הסוגיות
    document.getElementById('openSettingsBtn').addEventListener('click', openSettingsPanel);
    document.getElementById('closeSettingsBtn').addEventListener('click', closeAllOverlays);
    document.getElementById('openSugyotBtn').addEventListener('click', openSugyotPanel);
    document.getElementById('closeSugyotBtn').addEventListener('click', closeAllOverlays);
    document.getElementById('overlayScrim').addEventListener('click', closeAllOverlays);

    // פעולות בתוך לשונית ההגדרות (ייצוא PDF, הדפסה, טעינת דוגמה)
    document.getElementById('settingsExportPdfBtn').addEventListener('click', handleExportPdfClick);
    document.getElementById('settingsPrintBtn').addEventListener('click', handlePrintClick);
    document.getElementById('settingsLoadDemoBtn').addEventListener('click', loadDemoIntoCurrentChart);

    // הגדרות: שינוי טקסט "ולכן"
    document.getElementById('velachenTextInput').addEventListener('input', function (e) {
      workspace.settings.velachenText = e.target.value;
      document.getElementById('velachenPreviewText').textContent = e.target.value.trim() || 'ולכן';
      persistWorkspaceDebounced();
      renderTree();
    });

    // הגדרות: מתגים
    document.getElementById('switchShowDots').addEventListener('click', function () {
      workspace.settings.showDots = !(workspace.settings.showDots !== false);
      syncSwitch('switchShowDots', workspace.settings.showDots);
      applyVisualSettings();
      persistWorkspaceNow();
    });

    document.getElementById('switchSidePane').addEventListener('click', function () {
      workspace.settings.openInSidePane = !(workspace.settings.openInSidePane !== false);
      syncSwitch('switchSidePane', workspace.settings.openInSidePane);
      persistWorkspaceNow();
    });

    // פאנל הסוגיות שלי
    document.getElementById('newSugyaBtn').addEventListener('click', function () {
      const fresh = Data.createBlankSugya('סוגיה חדשה ' + (workspace.charts.length + 1));
      workspace.charts.unshift(fresh);
      workspace.activeChartId = fresh.id;
      activeFilterType = null;
      currentZoom = 1;
      applyZoom();
      resetHistory();
      persistWorkspaceNow();
      renderAll();
      closeAllOverlays();
      const inp = document.getElementById('sugyaTitleInput');
      if (inp) { inp.focus(); inp.select(); }
    });

    document.getElementById('newDemoSugyaBtn').addEventListener('click', function () {
      const demo = Data.createDemoSugya();
      workspace.charts.unshift(demo);
      workspace.activeChartId = demo.id;
      activeFilterType = null;
      currentZoom = 1;
      applyZoom();
      resetHistory();
      persistWorkspaceNow();
      renderAll();
      closeAllOverlays();
      Bridge.notifySuccess('נוספה סוגיית דוגמה: זה נהנה וזה לא חסר');
    });

    document.getElementById('sugyaSearchInput').addEventListener('input', renderSugyotDrawer);

    // ניקוי תרשים
    document.getElementById('clearChartBtn').addEventListener('click', async function () {
      const chart = getActiveChart();
      if (!chart.nodes || chart.nodes.length === 0) return;
      const ok = await Bridge.confirmAction('ניקוי התרשים', 'האם למחוק את כל השלבים בסוגיה "' + (chart.title || 'הנוכחית') + '"?');
      if (!ok) return;
      pushUndoSnapshot();
      chart.nodes = [];
      chart.updatedAt = Date.now();
      activeFilterType = null;
      persistWorkspaceNow();
      renderAll();
      Bridge.notifyMessage('התרשים נוקה');
    });

    // תפריט "עוד פעולות"
    const moreBtn = document.getElementById('moreMenuBtn');
    const morePopover = document.getElementById('moreMenuPopover');
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      morePopover.classList.toggle('open');
    });
    document.addEventListener('click', function () {
      closeMoreMenu();
    });
    morePopover.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    document.getElementById('menuExportJson').addEventListener('click', function () {
      closeMoreMenu();
      handleExportCurrentJson();
    });
    document.getElementById('menuExportAllJson').addEventListener('click', function () {
      closeMoreMenu();
      handleExportAllJson();
    });
    document.getElementById('menuImportJson').addEventListener('click', function () {
      closeMoreMenu();
      handleImportJsonClick();
    });
    document.getElementById('menuExpandAll').addEventListener('click', function () {
      closeMoreMenu();
      setAllCollapsed(getActiveChart().nodes, false, 0);
      persistWorkspaceNow();
      renderTree();
    });
    document.getElementById('menuCollapseAll').addEventListener('click', function () {
      closeMoreMenu();
      setAllCollapsed(getActiveChart().nodes, true, 0);
      persistWorkspaceNow();
      renderTree();
    });
    document.getElementById('menuAbout').addEventListener('click', function () {
      closeMoreMenu();
      openAboutModal();
    });

    // ייבוא fallback
    document.getElementById('importJsonInput').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (ev) {
        importParsedJsonText(String(ev.target.result || ''));
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    // מודאל בחירת שלב
    document.getElementById('closePickerBtn').addEventListener('click', closeStepPicker);
    document.getElementById('stepPickerModal').addEventListener('click', function (e) {
      if (e.target.id === 'stepPickerModal') closeStepPicker();
    });

    // מודאל קישור מקור
    document.getElementById('closeSourceModalBtn').addEventListener('click', closeSourceModal);
    document.getElementById('cancelSourceModalBtn').addEventListener('click', closeSourceModal);
    document.getElementById('sourceModal').addEventListener('click', function (e) {
      if (e.target.id === 'sourceModal') closeSourceModal();
    });
    document.getElementById('sourceSearchInput').addEventListener('input', function (e) {
      clearTimeout(sourceSearchTimer);
      const q = e.target.value.trim();
      sourceSearchTimer = setTimeout(function () {
        runSourceSearch(q);
      }, 260);
    });
    document.getElementById('unlinkSourceBtn').addEventListener('click', function () {
      const chart = getActiveChart();
      const node = Data.findNodeById(chart.nodes, sourceModalNodeId);
      if (node && node.source) {
        pushUndoSnapshot();
        delete node.source;
        chart.updatedAt = Date.now();
        persistWorkspaceNow();
        renderTree();
      }
      closeSourceModal();
    });

    // מודאל אודות
    document.getElementById('closeAboutBtn').addEventListener('click', closeAboutModal);
    document.getElementById('closeAboutFooterBtn').addEventListener('click', closeAboutModal);
    document.getElementById('aboutModal').addEventListener('click', function (e) {
      if (e.target.id === 'aboutModal') closeAboutModal();
    });
    document.getElementById('createDesktopShortcutBtn').addEventListener('click', function () {
      Bridge.createShortcut('desktop');
    });
    document.getElementById('createStartShortcutBtn').addEventListener('click', function () {
      Bridge.createShortcut('startMenu');
    });

    // קיצורי מקלדת
    document.addEventListener('keydown', function (e) {
      if (tourState.active) {
        if (e.key === 'Escape') {
          endGuidedTour();
        } else if (e.key === 'ArrowLeft' || e.key === 'Enter') {
          e.preventDefault();
          if (tourState.stepIndex < TOUR_STEPS.length - 1) {
            tourState.stepIndex += 1;
            positionTourStep();
          } else {
            endGuidedTour();
          }
        } else if (e.key === 'ArrowRight' && tourState.stepIndex > 0) {
          e.preventDefault();
          tourState.stepIndex -= 1;
          positionTourStep();
        }
        return;
      }

      const pickerOpen = document.getElementById('stepPickerModal').classList.contains('open');

      if (e.key === 'Escape') {
        const hadModal =
          pickerOpen ||
          document.getElementById('sourceModal').classList.contains('open') ||
          document.getElementById('aboutModal').classList.contains('open') ||
          document.getElementById('overlayScrim').classList.contains('open');
        closeStepPicker();
        closeSourceModal();
        closeAboutModal();
        closeAllOverlays();
        closeMoreMenu();
        if (!hadModal && readerState.open) {
          closeSourceReaderPane();
        }
        return;
      }

      if (pickerOpen && e.key >= '1' && e.key <= '6' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const idx = parseInt(e.key, 10) - 1;
        if (Data.STEP_TYPES[idx]) {
          e.preventDefault();
          selectStepTypeFromPicker(Data.STEP_TYPES[idx].id);
        }
        return;
      }

      const activeTag = document.activeElement && document.activeElement.tagName;
      const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

      if ((e.ctrlKey || e.metaKey) && !isEditingText) {
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault();
          performUndo();
        } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
          e.preventDefault();
          performRedo();
        }
      }
    });
  }

  // --- אתחול ---
  Bridge.init(async function () {
    bindEvents();
    await loadWorkspace();
    applyZoom();
    renderAll();

    // בהפעלה הראשונה בלבד — פתיחת מסך הפתיחה של המדריך הצעד-אחר-צעד (ניתן לדלג בלחיצה)
    if (!workspace.settings.tourCompleted) {
      setTimeout(function () {
        if (!tourState.active) startGuidedTour();
      }, 450);
    }
  });
})();
