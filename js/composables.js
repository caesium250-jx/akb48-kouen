/**
 * composables.js — AKB48 Theater Schedule 可组合函数
 *
 * 使用 Vue 3 Composition API 拆分逻辑层：
 *   useDataStore → 原始数据管理、localStorage、API 刷新
 *   useCalendar  → 日历天数、月份导航、当前月事件列表
 *   useFilter    → 成员/事件筛选、分组
 */

const { ref, computed } = Vue;

// =============================================================
//  useDataStore — 公演数据持久化与 API 交互
// =============================================================

const STORAGE_KEY = 'akb48_theater_data';

function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 合并策略：localStorage 持所有历史数据，EMBEDDED_DATA 提供最新覆盖
      // 这样刷新不丢数据，部署新 data.js 也能获得更新
      return { ...parsed, ...EMBEDDED_DATA };
    }
  } catch (_) { /* ignore */ }
  return { ...EMBEDDED_DATA };
}

function saveToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) { /* localStorage quota exceeded */ }
}

function useDataStore() {
  const merged = loadFromStorage();
  // 清理历史缓存中的休館日数据
  for (const dateKey of Object.keys(merged)) {
    merged[dateKey] = merged[dateKey].filter(ev => ev.title !== '休館日' && ev.title !== '休馆日');
    if (merged[dateKey].length === 0) delete merged[dateKey];
  }
  const scheduleData = ref(merged);
  // 初始化时自动持久化全量数据，刷新后不丢失
  saveToStorage(merged);

  // ---- 成员列表（跨所有月份聚合） ----
  const memberList = computed(() => {
    const names = new Set();
    for (const events of Object.values(scheduleData.value)) {
      for (const ev of events) {
        if (ev.title === '休館日' || ev.title === '休馆日' || !ev.members) continue;
        ev.members.split(',').filter(Boolean).forEach(id => {
          const name = MEMBER_MAP[id];
          if (name) names.add(name);
        });
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
  });

  // ---- 按年月提取原始数据 ----
  function getMonthData(year, month) {
    const prefix = `${year}_${month}`;
    const result = {};
    for (const [k, v] of Object.entries(scheduleData.value)) {
      if (k.startsWith(prefix)) result[k] = v;
    }
    return result;
  }

  // ---- 成员出演统计（2026年已过公演数） ----
  const memberStats = computed(() => {
    const todayStr = padDate(new Date());
    const counts = {};
    for (const name of memberList.value) counts[name] = 0;
    for (const [dateKey, events] of Object.entries(scheduleData.value)) {
      const parts = dateKey.split('_');
      if (parts[0] !== '2026') continue;
      const dateStr = `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`;
      if (dateStr >= todayStr) continue;
      for (const ev of events) {
        if (!ev.members) continue;
        for (const id of ev.members.split(',').filter(Boolean)) {
          const name = MEMBER_MAP[id];
          if (name && counts[name] !== undefined) counts[name]++;
        }
      }
    }
    return counts;
  });

  return {
    scheduleData,
    memberList,
    memberStats,
    getMonthData
  };
}


// =============================================================
//  useCalendar — 日历与月份导航
//  依赖: 需要 dataStore.getMonthData() 判断日期是否有事件
// =============================================================

function useCalendar(dataStore) {
  const now = new Date();
  const year = ref(now.getFullYear());
  const month = ref(now.getMonth() + 1);
  const selectedDate = ref(null);

  // ---- 当前月份原始数据（响应式：跟随 year/month 变化） ----
  const currentMonthRaw = computed(() => dataStore.getMonthData(year.value, month.value));

  // ---- JST→CST 时间转换（日本时间 → 北京时间，减1小时） ----
  function jstToCst(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return timeStr;
    let cstHour = h - 1;
    if (cstHour < 0) cstHour += 24;
    return `${pad(cstHour)}:${pad(m)}`;
  }

  // ---- 当前月事件扁平列表 ----
  const allEvents = computed(() => {
    const list = [];
    for (const [dateKey, events] of Object.entries(currentMonthRaw.value)) {
      const parts = dateKey.split('_');
      const dateStr = `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`;
      events.forEach((ev, idx) => {
        const memberIds = ev.members ? ev.members.split(',').filter(Boolean) : [];
        const memberNames = memberIds.map(id => MEMBER_MAP[id]).filter(Boolean);
        list.push({
          id: `${dateKey}-${idx}`,
          date: dateStr,
          time: jstToCst(ev.time) || '',
          title: ev.title || '内容待定',
          notice: ev.notice || '',
          subtitle: ev.subtitle || '',
          videoUrl: ev.videoUrl || '',
          memberIds,
          memberNames,
          location: 'AKB48剧场'
        });
      });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  });

  // ---- 判断某天是否有事件（用于日历圆点标记） ----
  function checkHasEvent(dateStr) {
    const [y, m, d] = dateStr.split('-');
    const key = `${y}_${parseInt(m)}_${parseInt(d)}`;
    const data = currentMonthRaw.value[key];
    return data ? data.some(e => e.title !== '休館日' && e.title !== '休馆日') : false;
  }

  // ---- 日历网格 ----
  const calendarDays = computed(() => {
    const y = year.value;
    const m = month.value - 1;
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startDow = first.getDay();
    const todayStr = padDate(new Date());
    const days = [];

    // 上月填充
    const prevLast = new Date(y, m, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevLast - i;
      const py = m === 0 ? y - 1 : y;
      const pm = m === 0 ? 11 : m - 1;
      const ds = `${py}-${pad(pm + 1)}-${pad(d)}`;
      days.push({
        key: `p${d}`, day: d, dateStr: ds,
        inMonth: false, isToday: ds === todayStr,
        hasEvent: checkHasEvent(ds)
      });
    }

    // 本月
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
      days.push({
        key: `c${d}`, day: d, dateStr: ds,
        inMonth: true, isToday: ds === todayStr,
        hasEvent: checkHasEvent(ds)
      });
    }

    // 下月填充
    const rem = 7 - (days.length % 7 || 7);
    for (let d = 1; d < rem; d++) {
      const ny = m === 11 ? y + 1 : y;
      const nm = m === 11 ? 0 : m + 1;
      const ds = `${ny}-${pad(nm + 1)}-${pad(d)}`;
      days.push({
        key: `n${d}`, day: d, dateStr: ds,
        inMonth: false, isToday: ds === todayStr,
        hasEvent: checkHasEvent(ds)
      });
    }

    return days;
  });

  // ---- 月份导航 ----
  function prevMonth() {
    if (month.value === 1) { month.value = 12; year.value--; }
    else { month.value--; }
    selectedDate.value = null;
  }

  function nextMonth() {
    if (month.value === 12) { month.value = 1; year.value++; }
    else { month.value++; }
    selectedDate.value = null;
  }

  function goToday() {
    const now = new Date();
    year.value = now.getFullYear();
    month.value = now.getMonth() + 1;
    selectedDate.value = padDate(now);
  }

  function selectDate(ds) {
    selectedDate.value = selectedDate.value === ds ? null : ds;
  }

  return {
    year,
    month,
    selectedDate,
    allEvents,
    calendarDays,
    currentMonthRaw,
    prevMonth,
    nextMonth,
    goToday,
    selectDate
  };
}


// =============================================================
//  useFilter — 成员 & 事件筛选
//  依赖: calendar.allEvents, calendar.selectedDate
// =============================================================

function useFilter(calendar) {
  const selectedMembers = ref(new Set());
  const showFutureOnly = ref(false);

  // ---- 筛选 & 按日期分组 ----
  const groupedEvents = computed(() => {
    const todayStr = padDate(new Date());
    const groups = {};
    for (const ev of calendar.allEvents.value) {
      // 成员筛选（交集：所有选中成员必须同时出演）
      if (selectedMembers.value.size > 0 &&
        ![...selectedMembers.value].every(m => ev.memberNames.includes(m))) {
        continue;
      }
      // 日期筛选
      if (calendar.selectedDate.value && ev.date !== calendar.selectedDate.value) {
        continue;
      }
      // 今日起筛选
      if (showFutureOnly.value && ev.date < todayStr) {
        continue;
      }
      if (!groups[ev.date]) groups[ev.date] = [];
      groups[ev.date].push(ev);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  });

  function toggleMember(name) {
    const s = new Set(selectedMembers.value);
    if (s.has(name)) s.delete(name);
    else s.add(name);
    selectedMembers.value = s;
  }

  function clearMemberFilter() {
    selectedMembers.value = new Set();
  }

  return {
    selectedMembers,
    groupedEvents,
    showFutureOnly,
    toggleMember,
    clearMemberFilter
  };
}


// =============================================================
//  辅助函数（共享）
// =============================================================

function pad(n) {
  return String(parseInt(n)).padStart(2, '0');
}

function padDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}

function getDayOfWeek(dateStr) {
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return '星期' + days[new Date(dateStr).getDay()];
}
