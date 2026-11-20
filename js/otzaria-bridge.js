/* ============================================================================
   גשר תקשורת עם Otzaria Plugin SDK + תאימות מלאה לדפדפן עצמאי
   ============================================================================ */
(function () {
  'use strict';

  const LOCAL_STORAGE_PREFIX = 'otzaria_sugya_map_v1_';

  const bridgeState = {
    inOtzaria: typeof window.Otzaria !== 'undefined',
    booted: false,
    pluginId: 'com.levgood.sugya-map',
    pluginVersion: '1.0.0',
    appVersion: '',
    platform: 'web',
    permissions: [],
    isDark: false
  };

  function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== 'string') return '';
    const cleaned = hex.replace('#', '').trim();
    if (cleaned.length === 3) {
      const r = parseInt(cleaned[0] + cleaned[0], 16);
      const g = parseInt(cleaned[1] + cleaned[1], 16);
      const b = parseInt(cleaned[2] + cleaned[2], 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (cleaned.length >= 6) {
      const r = parseInt(cleaned.slice(0, 2), 16);
      const g = parseInt(cleaned.slice(2, 4), 16);
      const b = parseInt(cleaned.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return '';
  }

  function applyTheme(theme) {
    if (!theme || !theme.colorScheme) return;
    const cs = theme.colorScheme;
    const root = document.documentElement;

    const map = {
      '--color-primary': cs.primary,
      '--color-on-primary': cs.onPrimary,
      '--color-primary-container': cs.primaryContainer,
      '--color-on-primary-container': cs.onPrimaryContainer,
      '--color-secondary': cs.secondary,
      '--color-on-secondary': cs.onSecondary,
      '--color-secondary-container': cs.secondaryContainer,
      '--color-on-secondary-container': cs.onSecondaryContainer,
      '--color-tertiary': cs.tertiary,
      '--color-on-tertiary': cs.onTertiary,
      '--color-surface': cs.surface,
      '--color-on-surface': cs.onSurface,
      '--color-on-surface-variant': cs.onSurfaceVariant,
      '--color-surface-container-lowest': cs.surfaceContainerLowest,
      '--color-surface-container-low': cs.surfaceContainerLow,
      '--color-surface-container': cs.surfaceContainer,
      '--color-surface-container-high': cs.surfaceContainerHigh,
      '--color-surface-container-highest': cs.surfaceContainerHighest,
      '--color-error': cs.error,
      '--color-on-error': cs.onError,
      '--color-error-container': cs.errorContainer,
      '--color-on-error-container': cs.onErrorContainer,
      '--color-outline': cs.outline,
      '--color-outline-variant': cs.outlineVariant || cs.outline,
      '--color-scrim': cs.scrim,
      '--color-inverse-surface': cs.inverseSurface,
      '--color-on-inverse-surface': cs.onInverseSurface
    };

    Object.keys(map).forEach(function (prop) {
      if (map[prop]) {
        root.style.setProperty(prop, map[prop]);
      }
    });

    if (cs.primary) {
      root.style.setProperty('--color-primary-subtle', hexToRgba(cs.primary, 0.13));
      root.style.setProperty('--color-hover-tint', hexToRgba(cs.primary, 0.08));
    }
    if (cs.secondary) {
      root.style.setProperty('--color-secondary-subtle', hexToRgba(cs.secondary, 0.13));
    }
    if (cs.error) {
      root.style.setProperty('--color-error-subtle', hexToRgba(cs.error, 0.11));
    }

    const isDark = theme.mode === 'dark';
    bridgeState.isDark = isDark;
    document.body.classList.toggle('dark-mode', isDark);

    if (theme.surfaces) {
      if (theme.surfaces.panel) root.style.setProperty('--surface-panel', theme.surfaces.panel);
      if (theme.surfaces.card) root.style.setProperty('--surface-card', theme.surfaces.card);
      if (theme.surfaces.topBar) root.style.setProperty('--surface-top-bar', theme.surfaces.topBar);
    } else {
      root.style.setProperty('--surface-panel', cs.surfaceContainerLowest || cs.surface);
      root.style.setProperty('--surface-card', cs.surface);
      root.style.setProperty('--surface-top-bar', cs.surfaceContainerHigh || cs.surface);
    }

    if (theme.typography) {
      const t = theme.typography;
      if (t.uiFont) {
        root.style.setProperty('--font-ui', t.uiFont);
      } else if (t.uiFontFamily) {
        root.style.setProperty('--font-ui', `'${t.uiFontFamily}', system-ui, sans-serif`);
      }
      if (t.fontFamily) {
        root.style.setProperty('--font-main', `'${t.fontFamily}', 'David', serif`);
      }
      if (t.fontSize) {
        root.style.setProperty('--font-size-base', `${t.fontSize}px`);
      }
      if (t.lineHeight) {
        root.style.setProperty('--line-height', String(t.lineHeight));
      }
    }

    if (theme.radius != null) {
      root.style.setProperty('--radius', `${theme.radius}px`);
    }
    if (theme.density && theme.density.topBarHeight) {
      root.style.setProperty('--top-bar-height', `${theme.density.topBarHeight}px`);
    }
  }

  function hasPermission(perm) {
    if (!bridgeState.inOtzaria) return false;
    return bridgeState.permissions.indexOf(perm) !== -1;
  }

  function isDesktop() {
    return ['windows', 'macos', 'linux'].indexOf(bridgeState.platform) !== -1;
  }

  // --- Toast מקומי לדפדפן עצמאי ---
  let toastTimer = null;
  function showLocalToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('visible');
    }, 2500);
  }

  async function notifySuccess(message) {
    if (bridgeState.inOtzaria) {
      const res = await Otzaria.call('ui.showSuccess', { message: message });
      if (res && res.success) return;
    }
    showLocalToast(message);
  }

  async function notifyMessage(message) {
    if (bridgeState.inOtzaria) {
      const res = await Otzaria.call('ui.showMessage', { message: message });
      if (res && res.success) return;
    }
    showLocalToast(message);
  }

  async function notifyError(message) {
    if (bridgeState.inOtzaria) {
      const res = await Otzaria.call('ui.showError', { message: message });
      if (res && res.success) return;
    }
    showLocalToast(message);
  }

  async function confirmAction(title, content) {
    if (bridgeState.inOtzaria) {
      const res = await Otzaria.call('ui.showConfirm', {
        title: title,
        content: content
      });
      if (res && res.success && res.data) {
        return !!res.data.confirmed;
      }
    }
    return new Promise(function (resolve) {
      const modal = document.getElementById('confirmModal');
      const titleEl = document.getElementById('confirmTitle');
      const msgEl = document.getElementById('confirmMessage');
      const okBtn = document.getElementById('confirmOkBtn');
      const cancelBtn = document.getElementById('confirmCancelBtn');
      if (!modal || !okBtn || !cancelBtn) {
        resolve(false);
        return;
      }
      titleEl.textContent = title;
      msgEl.textContent = content;
      modal.classList.add('open');

      function cleanup(result) {
        modal.classList.remove('open');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdrop(e) { if (e.target === modal) cleanup(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
    });
  }

  // --- אחסון פרטי ---
  async function storageGet(key) {
    if (bridgeState.inOtzaria) {
      try {
        const res = await Otzaria.call('storage.get', { key: key });
        if (res && res.success) return res.data;
      } catch (err) {
        console.error('storage.get error:', err);
      }
      return null;
    }
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function storageSet(key, value) {
    if (value == null) return false;
    if (bridgeState.inOtzaria) {
      try {
        const res = await Otzaria.call('storage.set', { key: key, value: value });
        return !!(res && res.success);
      } catch (err) {
        console.error('storage.set error:', err);
        return false;
      }
    }
    try {
      localStorage.setItem(LOCAL_STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  // --- הדפסה וייצוא PDF ---
  async function exportPdf(fileName, orientation) {
    if (!bridgeState.inOtzaria) {
      window.print();
      return { saved: true, fallback: true };
    }
    const res = await Otzaria.call('ui.exportPdf', {
      fileName: fileName || 'מבנה_הסוגיא',
      title: 'ייצוא תרשים מבנה הסוגיא ל-PDF',
      pageSize: 'a4',
      orientation: orientation || 'landscape',
      marginMm: 10,
      printBackgrounds: true
    });
    if (res && res.success) {
      return res.data || { saved: false };
    }
    return { saved: false, error: res && res.error ? res.error.message : 'שגיאה בייצוא PDF' };
  }

  async function printChart(jobName, orientation) {
    if (!bridgeState.inOtzaria) {
      window.print();
      return { printed: true };
    }
    const res = await Otzaria.call('ui.print', {
      jobName: jobName || 'מבנה הסוגיא',
      pageSize: 'a4',
      orientation: orientation || 'landscape',
      marginMm: 10,
      printBackgrounds: true
    });
    if (res && res.success) {
      return res.data || { printed: false };
    }
    window.print();
    return { printed: true };
  }

  // --- סניטיזציה בטוחה של HTML מספרים ---
  function sanitizeBookHtml(rawHtml) {
    if (!rawHtml) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString('<div>' + String(rawHtml) + '</div>', 'text/html');
    const allowedTags = {
      DIV: true, P: true, BR: true, SPAN: true, B: true, STRONG: true,
      I: true, EM: true, U: true, SMALL: true, BIG: true, SUB: true, SUP: true,
      H1: true, H2: true, H3: true, H4: true, H5: true, H6: true, BLOCKQUOTE: true
    };

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.nodeValue || '');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return document.createTextNode('');
      }
      const tag = node.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') {
        return document.createTextNode('');
      }
      const out = allowedTags[tag]
        ? document.createElement(tag.toLowerCase())
        : document.createElement('span');
      for (let i = 0; i < node.childNodes.length; i++) {
        out.appendChild(cleanNode(node.childNodes[i]));
      }
      return out;
    }

    const root = doc.body.firstChild;
    const container = document.createElement('div');
    if (root) {
      for (let i = 0; i < root.childNodes.length; i++) {
        container.appendChild(cleanNode(root.childNodes[i]));
      }
    }
    return container.innerHTML;
  }

  // --- ספרייה וקורא אוצריא ---
  async function resolveRef(query, limit) {
    if (!bridgeState.inOtzaria) return [];
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) return [];
    const res = await Otzaria.call('library.resolveRef', {
      ref: trimmed,
      limit: limit || 10
    });
    if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
      return res.data;
    }
    const booksRes = await Otzaria.call('library.findBooks', {
      query: trimmed,
      limit: limit || 8
    });
    if (booksRes && booksRes.success && Array.isArray(booksRes.data)) {
      return booksRes.data.map(function (b) {
        return {
          id: b.id != null ? b.id : null,
          bookId: b.bookId || b.title,
          type: b.type || 'text',
          title: b.title || b.bookId,
          reference: b.title || b.bookId,
          index: 0,
          isPdf: b.type === 'pdf',
          bookPath: Array.isArray(b.topics) ? b.topics.join(' / ') : ''
        };
      });
    }
    return [];
  }

  async function resolveSourceTarget(source) {
    if (!source) return null;
    if (!bridgeState.inOtzaria) return source;
    if (typeof source.index === 'number' && source.index >= 0 && (source.bookId || source.title)) {
      return source;
    }
    if ((source.reference || source.ref) && hasPermission('library.books.read')) {
      try {
        const hits = await resolveRef(source.reference || source.ref, 1);
        if (hits && hits.length > 0) {
          return Object.assign({}, source, {
            id: hits[0].id != null ? hits[0].id : source.id,
            bookId: hits[0].bookId || hits[0].title || source.bookId,
            title: hits[0].title || source.title,
            type: hits[0].type || source.type || 'text',
            reference: hits[0].reference || source.reference,
            index: typeof hits[0].index === 'number' ? hits[0].index : 0,
            isPdf: !!hits[0].isPdf,
            isUserBook: !!hits[0].isUserBook
          });
        }
      } catch (_) {}
    }
    return source;
  }

  async function loadBookPassage(source, startLine, lineCount) {
    const count = lineCount || 26;
    const resolved = await resolveSourceTarget(source);
    if (!resolved) {
      return { ok: false, reason: 'not_found', message: 'מקור לא נמצא' };
    }

    // תצוגת דמה במצב דפדפן חיצוני (מחוץ לאוצריא)
    if (!bridgeState.inOtzaria) {
      return {
        ok: true,
        resolved: resolved,
        startLine: startLine || 0,
        endLine: (startLine || 0) + count - 1,
        html: sanitizeBookHtml(
          '<h3>' + (resolved.reference || resolved.title || 'מקור') + '</h3>' +
          '<p>זוהי תצוגה מקדימה של חלונית המקור המובנית (במצב דפדפן). בתוך תוכנת אוצריא יוצג כאן הטקסט המלא של הספר מתוך הספרייה, עם כפתור סגירה מהיר והחלפה מיידית בין מקורות.</p>'
        )
      };
    }

    if (resolved.isPdf || resolved.type === 'pdf') {
      return {
        ok: false,
        reason: 'pdf',
        resolved: resolved,
        message: 'ספר זה הוא קובץ PDF — ניתן לפתוח אותו ישירות בכרטיסייה באוצריא.'
      };
    }

    const fromLine = Math.max(0, typeof startLine === 'number' ? startLine : (typeof resolved.index === 'number' ? resolved.index : 0));
    const toLine = fromLine + count - 1;
    const bookTitle = resolved.title || resolved.bookId;

    // 1. ניסיון ראשי: קריאת טווח שורות מדויק לפי אינדקס דרך library.getLinkContent
    if (bookTitle) {
      try {
        const linkItem = {
          targetTitle: bookTitle,
          targetLine: fromLine,
          targetLineEnd: toLine
        };
        if (resolved.isUserBook) {
          linkItem.targetIsUserBook = true;
        }
        const linkRes = await Otzaria.call('library.getLinkContent', {
          links: [linkItem]
        });
        if (linkRes && linkRes.success && linkRes.data && Array.isArray(linkRes.data.items) && linkRes.data.items[0]) {
          const item = linkRes.data.items[0];
          if (item.error === 'forbidden') {
            return {
              ok: false,
              reason: 'forbidden',
              resolved: resolved,
              message: 'ספר זה מוגן ע״י המו״ל להצגה בתוספים — ניתן לפתוח אותו ישירות בכרטיסייה באוצריא.'
            };
          }
          if (item.content && String(item.content).trim().length > 0) {
            return {
              ok: true,
              resolved: resolved,
              startLine: fromLine,
              endLine: toLine,
              html: sanitizeBookHtml(item.content)
            };
          }
        }
      } catch (err) {
        console.warn('getLinkContent fallback:', err);
      }
    }

    // 2. גיבוי: קריאת קטע ספר דרך library.getBookContent
    try {
      const contentRes = await Otzaria.call('library.getBookContent', {
        bookId: resolved.bookId || bookTitle,
        section: resolved.reference || '',
        offset: 0,
        limit: 4500
      });
      if (contentRes && contentRes.success && contentRes.data) {
        return {
          ok: true,
          resolved: resolved,
          startLine: fromLine,
          endLine: toLine,
          html: sanitizeBookHtml(String(contentRes.data).replace(/\n/g, '<br>'))
        };
      }
      if (contentRes && contentRes.error && contentRes.error.code === 'permission_denied') {
        return {
          ok: false,
          reason: 'permission',
          resolved: resolved,
          message: 'כדי להציג את טקסט הספר בתוך חלונית הצד, יש לאשר את הרשאת קריאת תוכן ספרים (library.content.read) בהגדרות התוסף.'
        };
      }
    } catch (_) {}

    return {
      ok: false,
      reason: 'not_found',
      resolved: resolved,
      message: 'לא ניתן לטעון את הטקסט בחלונית הצד. ניתן לפתוח את הספר בכרטיסייה רגילה באוצריא.'
    };
  }

  async function getOpenReaderBooks() {
    if (!bridgeState.inOtzaria) return [];
    const results = [];
    const seen = {};

    const stateRes = await Otzaria.call('reader.getCurrentState');
    if (stateRes && stateRes.success && stateRes.data && Array.isArray(stateRes.data.openTabs)) {
      stateRes.data.openTabs.forEach(function (tab) {
        if (tab.isSelf || tab.toolId) return;
        const bookName = tab.book || tab.bookId;
        if (!bookName) return;
        const key = `${bookName}::${tab.index || 0}`;
        if (seen[key]) return;
        seen[key] = true;
        results.push({
          id: tab.id != null ? tab.id : null,
          bookId: tab.bookId || bookName,
          type: tab.type || 'text',
          title: bookName,
          reference: tab.currentRef || bookName,
          index: tab.index || 0,
          isPdf: tab.type === 'pdf'
        });
      });
    }

    if (results.length === 0) {
      const refRes = await Otzaria.call('reader.getCurrentRef');
      if (refRes && refRes.success && refRes.data && (refRes.data.currentBookId || refRes.data.currentBook)) {
        const d = refRes.data;
        results.push({
          id: d.currentId != null ? d.currentId : null,
          bookId: d.currentBookId || d.currentBook,
          type: d.currentType || 'text',
          title: d.currentBook || d.currentBookId,
          reference: d.currentRef || d.currentBook || d.currentBookId,
          index: d.currentIndex || 0,
          isPdf: d.currentType === 'pdf'
        });
      }
    }

    return results;
  }

  async function openOtzariaTab(source) {
    if (!bridgeState.inOtzaria || !source) return false;
    const resolved = await resolveSourceTarget(source);

    if (typeof resolved.index === 'number') {
      const payload = {
        bookId: resolved.bookId || resolved.title,
        index: resolved.index,
        openInSidePane: false,
        navigateToPositionIfReused: true
      };
      if (resolved.id != null) payload.id = resolved.id;
      if (resolved.type) payload.type = resolved.type;

      const res = await Otzaria.call('reader.openBook', payload);
      if (res && res.success && res.data) return true;
    }

    if (resolved.reference || resolved.ref) {
      const refRes = await Otzaria.call('reader.openBookAtRef', {
        bookId: resolved.bookId || resolved.title || '',
        ref: resolved.reference || resolved.ref
      });
      return !!(refRes && refRes.success && refRes.data);
    }
    return false;
  }

  // --- ייצוא וייבוא קובצי JSON ---
  async function saveJsonFile(suggestedName, jsonText) {
    if (bridgeState.inOtzaria && hasPermission('fs.user_files.write')) {
      try {
        const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
        const beginRes = await Otzaria.call('fs.beginBinaryWrite', {
          purpose: 'user-file',
          expectedSize: blob.size
        });
        if (beginRes && beginRes.success && beginRes.data) {
          const putResp = await fetch(beginRes.data.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json;charset=utf-8' },
            body: blob
          });
          if (putResp.ok) {
            const commitRes = await Otzaria.call('fs.commitUserFileWrite', {
              writeToken: beginRes.data.writeToken,
              suggestedName: suggestedName || 'sugya-chart',
              extension: 'json',
              title: 'שמירת קובץ גיבוי לתרשים סוגיה'
            });
            if (commitRes && commitRes.success) {
              return commitRes.data;
            }
          }
        }
      } catch (err) {
        console.error('Native JSON save failed, falling back to blob download:', err);
      }
    }

    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (suggestedName || 'sugya_chart') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { cancelled: false, name: a.download };
  }

  async function pickAndReadJsonFile(fallbackInputEl) {
    if (bridgeState.inOtzaria && hasPermission('fs.user_files.read')) {
      const pickRes = await Otzaria.call('fs.pickUserFile', {
        title: 'בחר קובץ גיבוי של תרשים סוגיה (JSON)',
        extensions: ['json'],
        access: 'read'
      });
      if (pickRes && pickRes.success && pickRes.data) {
        if (pickRes.data.cancelled) return { cancelled: true };
        const readRes = await Otzaria.call('fs.readTextFile', {
          token: pickRes.data.token
        });
        if (readRes && readRes.success) {
          return { cancelled: false, text: readRes.data, name: pickRes.data.name };
        }
        return { cancelled: false, error: 'שגיאה בקריאת הקובץ' };
      }
    }

    if (fallbackInputEl) {
      fallbackInputEl.click();
      return { delegatedToInput: true };
    }
    return { cancelled: true };
  }

  // --- יצירת קיצור דרך לתוסף ---
  async function createShortcut(location) {
    if (!bridgeState.inOtzaria) {
      showLocalToast('יצירת קיצור דרך זמינה בתוך תוכנת אוצריא');
      return;
    }
    const res = await Otzaria.call('shortcut.create', {
      label: 'מבנה הסוגיא',
      location: location || 'desktop'
    });
    if (!res || !res.success) {
      await notifyError('לא ניתן ליצור קיצור דרך (בדוק את הרשאות התוסף)');
      return;
    }
    if (res.data && res.data.created) {
      await notifySuccess('קיצור הדרך נוצר בהצלחה');
    }
  }

  // --- אתחול מחזור חיים ---
  function initBridge(onReady) {
    if (bridgeState.inOtzaria) {
      Otzaria.on('plugin.boot', function (payload) {
        bridgeState.booted = true;
        if (payload) {
          if (payload.plugin) {
            bridgeState.pluginId = payload.plugin.id || bridgeState.pluginId;
            bridgeState.pluginVersion = payload.plugin.version || bridgeState.pluginVersion;
          }
          if (payload.app) {
            bridgeState.appVersion = payload.app.version || '';
            bridgeState.platform = payload.app.platform || 'windows';
          }
          if (Array.isArray(payload.permissions)) {
            bridgeState.permissions = payload.permissions.slice();
          }
          if (payload.theme) {
            applyTheme(payload.theme);
          }
        }
        if (typeof onReady === 'function') onReady(bridgeState);
      });

      Otzaria.on('theme.changed', function (theme) {
        applyTheme(theme);
      });

      Otzaria.on('plugin.suspended', function () {
        if (toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
        }
      });

      Otzaria.on('plugin.resumed', function () {});
    } else {
      window.addEventListener('DOMContentLoaded', function () {
        bridgeState.booted = true;
        if (typeof onReady === 'function') onReady(bridgeState);
      });
    }
  }

  window.SugyaBridge = {
    state: bridgeState,
    init: initBridge,
    applyTheme: applyTheme,
    hasPermission: hasPermission,
    isDesktop: isDesktop,
    storageGet: storageGet,
    storageSet: storageSet,
    notifySuccess: notifySuccess,
    notifyMessage: notifyMessage,
    notifyError: notifyError,
    confirmAction: confirmAction,
    exportPdf: exportPdf,
    printChart: printChart,
    resolveRef: resolveRef,
    loadBookPassage: loadBookPassage,
    getOpenReaderBooks: getOpenReaderBooks,
    openOtzariaTab: openOtzariaTab,
    saveJsonFile: saveJsonFile,
    pickAndReadJsonFile: pickAndReadJsonFile,
    createShortcut: createShortcut,
    showLocalToast: showLocalToast
  };
})();
