/* ============================================================================
   הגדרות שלבי הסוגיה, דוגמת "זה נהנה וזה לא חסר" ועזרי עץ
   ============================================================================ */
(function () {
  'use strict';

  const STEP_TYPES = [
    {
      id: 'yesod',
      num: 1,
      label: 'יסוד - מקור',
      placeholder: 'כתוב כאן את היסוד, הפסוק, המשנה או שאלת הסוגיה...',
      subtitlePlaceholder: 'מקור (למשל: גמרא / משנה / רמב״ם)',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>'
    },
    {
      id: 'deot',
      num: 2,
      label: 'דעות',
      placeholder: 'פרט את השיטה או הדעה (למשל: חייב / פטור / שיטת רש״י)...',
      subtitlePlaceholder: 'שם בעל הדעה / צד במחלוקת',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>'
    },
    {
      id: 'rayot',
      num: 3,
      label: 'ראיות',
      placeholder: 'כתוב את הראיה או ההוכחה לשיטה זו...',
      subtitlePlaceholder: 'מקור הראיה (משנה / ברייתא / סברא)',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>'
    },
    {
      id: 'dchiya',
      num: 4,
      label: 'דחיה לראיה',
      placeholder: 'כתוב את הקושיה או הדחיה על הראיה...',
      subtitlePlaceholder: 'מקור / כותרת הדחיה',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    },
    {
      id: 'teshuva',
      num: 5,
      label: 'תשובה לראיה',
      placeholder: 'כתוב את התירוץ, היישוב או התשובה...',
      subtitlePlaceholder: 'יישוב / תירוץ',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>'
    },
    {
      id: 'maskana',
      num: 6,
      label: 'מסקנא',
      placeholder: 'סכם את המסקנה היוצאת מן הדברים להלכה או למעשה...',
      subtitlePlaceholder: 'סיכום / מסקנה להלכה',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    }
  ];

  const DEFAULT_SETTINGS = {
    velachenMode: 'none',       // 'none' | 'all' | 'single'
    velachenSingleType: 'maskana',
    velachenText: 'ולכן',
    colorPalette: 'colorful',   // 'colorful' | 'otzaria'
    cardStyle: 'modern',        // 'modern' | 'classic'
    cardWidth: 'normal',        // 'compact' | 'normal' | 'wide'
    contentFont: 'ui',          // 'ui' | 'book'
    showDots: true,
    showSources: false,
    openInSidePane: true,
    pdfOrientation: 'auto',     // 'auto' | 'landscape' | 'portrait'
    readerFontSize: 19,
    tourCompleted: false
  };

  function generateId(prefix) {
    return (prefix || 'node') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function getStepMeta(typeId) {
    return STEP_TYPES.find(function (t) { return t.id === typeId; }) || STEP_TYPES[0];
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function findNodeById(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.id === id) return node;
      if (node.children && node.children.length > 0) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function findParentArrayAndIndex(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        return { list: nodes, index: i };
      }
      if (nodes[i].children && nodes[i].children.length > 0) {
        const found = findParentArrayAndIndex(nodes[i].children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function deleteNodeById(nodes, id) {
    const loc = findParentArrayAndIndex(nodes, id);
    if (!loc) return false;
    loc.list.splice(loc.index, 1);
    return true;
  }

  function moveNodeSibling(nodes, id, delta) {
    const loc = findParentArrayAndIndex(nodes, id);
    if (!loc) return false;
    const nextIndex = loc.index + delta;
    if (nextIndex < 0 || nextIndex >= loc.list.length) return false;
    const item = loc.list.splice(loc.index, 1)[0];
    loc.list.splice(nextIndex, 0, item);
    return true;
  }

  function countDescendants(node) {
    if (!node.children || node.children.length === 0) return 0;
    return node.children.reduce(function (acc, child) {
      return acc + 1 + countDescendants(child);
    }, 0);
  }

  function countAllNodes(nodes) {
    if (!Array.isArray(nodes)) return 0;
    return nodes.reduce(function (acc, node) {
      return acc + 1 + countDescendants(node);
    }, 0);
  }

  function countByType(nodes) {
    const counts = {};
    STEP_TYPES.forEach(function (t) { counts[t.id] = 0; });
    function walk(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (n) {
        if (counts[n.type] != null) counts[n.type] += 1;
        walk(n.children);
      });
    }
    walk(nodes);
    return counts;
  }

  function createBlankSugya(title) {
    const now = Date.now();
    return {
      id: generateId('sugya'),
      title: title || 'סוגיה חדשה',
      createdAt: now,
      updatedAt: now,
      nodes: []
    };
  }

  /**
   * דוגמה מובנית מהסוגיה המפורסמת "זה נהנה וזה לא חסר" (בבא קמא דף כ׳)
   */
  function createDemoSugya() {
    const now = Date.now();
    return {
      id: generateId('sugya'),
      title: 'זה נהנה וזה לא חסר (בבא קמא כ׳)',
      createdAt: now,
      updatedAt: now,
      nodes: [
        {
          id: generateId('node'),
          type: 'yesod',
          subtitle: 'בבא קמא דף כ׳ ע״א',
          text: 'זה נהנה וזה לא חסר — הדר בחצר חבירו שלא מדעתו (חצר דלא קיימא לאגרא וגברא דעביד למיגר): האם חייב להעלות לו שכר?',
          source: {
            bookId: 'בבא קמא',
            title: 'בבא קמא',
            reference: 'בבא קמא כ',
            index: null
          },
          collapsed: false,
          children: [
            {
              id: generateId('node'),
              type: 'deot',
              subtitle: 'צד א׳ בבעיא',
              text: 'חייב — כיוון שהדר נהנה מהמגורים, צריך לשלם לבעל החצר.',
              collapsed: false,
              children: [
                {
                  id: generateId('node'),
                  type: 'rayot',
                  subtitle: 'ראיה מהמשנה (ב״ק יט:)',
                  text: 'מהמשנה: "משלמת מה שנהנית" — משמע שעל עצם ההנאה חייב לשלם.',
                  source: {
                    bookId: 'בבא קמא',
                    title: 'בבא קמא',
                    reference: 'בבא קמא יט',
                    index: null
                  },
                  collapsed: false,
                  children: [
                    {
                      id: generateId('node'),
                      type: 'dchiya',
                      subtitle: 'דחיה',
                      text: 'הרי יש גם חסר — בעל הפירות חסר את מה שאכלה הבהמה.',
                      collapsed: false,
                      children: []
                    }
                  ]
                },
                {
                  id: generateId('node'),
                  type: 'rayot',
                  subtitle: 'המקיף חבירו מג׳ רוחותיו',
                  text: 'המקיף חבירו משלוש רוחותיו — אם גדר את הרביעית, מגלגלין עליו את הכל וחייב.',
                  collapsed: false,
                  children: [
                    {
                      id: generateId('node'),
                      type: 'dchiya',
                      subtitle: 'דחיה',
                      text: 'שכאן גם הוא חסר, בגלל שאת גרמת לי היקפא יתירא.',
                      collapsed: false,
                      children: []
                    }
                  ]
                },
                {
                  id: generateId('node'),
                  type: 'rayot',
                  subtitle: 'הבית והעליה — לשיטת ר׳ יהודה',
                  text: 'לשיטת ר׳ יהודה שמשלם בעל העליה לבעל הבית שכר דירה — ש״מ זה נהנה וזה לא חסר חייב.',
                  collapsed: false,
                  children: [
                    {
                      id: generateId('node'),
                      type: 'dchiya',
                      subtitle: 'דחיה',
                      text: 'שחרוריתא דאשייתא — בעל הבית חסר שהכתלים משחירים.',
                      collapsed: false,
                      children: []
                    }
                  ]
                }
              ]
            },
            {
              id: generateId('node'),
              type: 'deot',
              subtitle: 'צד ב׳ בבעיא',
              text: 'פטור — כיוון שבעל החצר לא הפסיד כלום, אינו צריך להעלות לו שכר.',
              collapsed: false,
              children: [
                {
                  id: generateId('node'),
                  type: 'rayot',
                  subtitle: 'דיוק מהניקף שגדר הרביעית',
                  text: 'אם עמד ניקף וגדר את הרביעית — חייב; משמע אם המקיף גדר את הרביעית — פטור! ש״מ זה נהנה וזה לא חסר פטור.',
                  collapsed: false,
                  children: [
                    {
                      id: generateId('node'),
                      type: 'dchiya',
                      subtitle: 'דחיה',
                      text: 'שאני התם דאמר ליה: לדידי סגי לי בשמירה בשווי זוז (לכן גם אין כאן הנאה שלמה).',
                      collapsed: false,
                      children: []
                    }
                  ]
                },
                {
                  id: generateId('node'),
                  type: 'rayot',
                  subtitle: 'הבית והעליה (תנא קמא)',
                  text: 'בעל העליה בונה את הבית ודר בו בחינם עד שיתן לו את יציאותיו — משמע דזה נהנה וזה לא חסר פטור.',
                  collapsed: false,
                  children: [
                    {
                      id: generateId('node'),
                      type: 'dchiya',
                      subtitle: 'דחיה',
                      text: 'דביתא לעליה משתעבד (הבית משועבד לבעל העליה, ולכן דר בשלו).',
                      collapsed: false,
                      children: []
                    }
                  ]
                },
                {
                  id: generateId('node'),
                  type: 'maskana',
                  subtitle: 'מסקנת הסוגיה (אמר רב)',
                  text: 'אמר רב: הדר בחצר חבירו שלא מדעתו אינו צריך להעלות לו שכר — זאת אומרת זה נהנה וזה לא חסר פטור.',
                  collapsed: false,
                  children: []
                }
              ]
            }
          ]
        }
      ]
    };
  }

  window.SugyaData = {
    STEP_TYPES: STEP_TYPES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    generateId: generateId,
    getStepMeta: getStepMeta,
    deepClone: deepClone,
    findNodeById: findNodeById,
    findParentArrayAndIndex: findParentArrayAndIndex,
    deleteNodeById: deleteNodeById,
    moveNodeSibling: moveNodeSibling,
    countDescendants: countDescendants,
    countAllNodes: countAllNodes,
    countByType: countByType,
    createBlankSugya: createBlankSugya,
    createDemoSugya: createDemoSugya
  };
})();
