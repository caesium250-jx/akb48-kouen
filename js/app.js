/**
 * app.js — AKB48 Theater Schedule 主应用
 *
 * 使用 Vue 3 Composition API + 自定义 composables。
 * 职责: 编排 composables、管理 UI 独有状态（弹窗）、暴露模板绑定
 */

// 注意: ref/computed 已在 composables.js 中声明，此处不重复声明
const { createApp } = Vue;

const app = createApp({
  setup() {
    // =============================================================
    //  1. 初始化 composables（依赖注入模式）
    // =============================================================
    const dataStore = useDataStore();
    const calendar = useCalendar(dataStore);
    const filter = useFilter(calendar);

    // =============================================================
    //  2. UI 状态
    // =============================================================
    const detailVisible = ref(false);
    const detailEvent = ref(null);
    const memberPanelOpen = ref(false);
    const calendarOpen = ref(true);
    const memberSearchQuery = ref('');

    function showDetail(ev) {
      detailEvent.value = ev;
      detailVisible.value = true;
    }

    function toggleMemberPanel() {
      memberPanelOpen.value = !memberPanelOpen.value;
    }

    function toggleCalendar() {
      calendarOpen.value = !calendarOpen.value;
    }

    // ---- 成员搜索过滤（按出演数降序排列） ----
    const filteredMemberList = computed(() => {
      const query = memberSearchQuery.value.trim().toLowerCase();
      let list = dataStore.memberList.value;
      if (query) {
        list = list.filter(name => name.toLowerCase().includes(query));
      }
      return [...list].sort((a, b) => {
        const ca = dataStore.memberStats.value[a] || 0;
        const cb = dataStore.memberStats.value[b] || 0;
        if (ca !== cb) return cb - ca;
        return a.localeCompare(b, 'ja');
      });
    });

    // =============================================================
    //  3. 播放按钮
    // =============================================================
    function isPastEvent(dateStr) {
      return dateStr && dateStr < padDate(new Date());
    }

    function openVideoUrl(ev) {
      if (ev.videoUrl) window.open(ev.videoUrl, '_blank');
    }

    // =============================================================
    //  4. 暴露模板绑定
    // =============================================================
    return {
      // Calendar
      year: calendar.year,
      month: calendar.month,
      selectedDate: calendar.selectedDate,
      allEvents: calendar.allEvents,
      calendarDays: calendar.calendarDays,

      // Filter
      selectedMembers: filter.selectedMembers,
      groupedEvents: filter.groupedEvents,
      showFutureOnly: filter.showFutureOnly,
      memberList: dataStore.memberList,
      memberStats: dataStore.memberStats,

      // Panels
      calendarOpen,
      memberPanelOpen,
      memberSearchQuery,
      filteredMemberList,
      toggleCalendar,
      toggleMemberPanel,

      // Dialog
      detailVisible,
      detailEvent,

      // Methods
      isPastEvent,
      openVideoUrl,
      prevMonth: calendar.prevMonth,
      nextMonth: calendar.nextMonth,
      goToday: calendar.goToday,
      selectDate: calendar.selectDate,
      toggleMember: filter.toggleMember,
      clearMemberFilter: filter.clearMemberFilter,
      showDetail,

      // Utilities
      formatDate,
      getDayOfWeek,
      pad
    };
  }
});
