/**
 * app.js — AKB48 Theater Schedule 主应用
 *
 * 使用 Vue 3 Composition API + 自定义 composables。
 * 职责: 编排 composables、管理 UI 独有状态（弹窗）、暴露模板绑定
 */

// 注意: ref/computed 已在 composables.js 中声明，此处不重复声明
const { createApp, onMounted } = Vue;

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

    // ---- 成员搜索过滤 ----
    const filteredMemberList = computed(() => {
      const query = memberSearchQuery.value.trim().toLowerCase();
      if (!query) return dataStore.memberList.value;
      return dataStore.memberList.value.filter(name =>
        name.toLowerCase().includes(query)
      );
    });

    // =============================================================
    //  3. 生命周期
    // =============================================================
    onMounted(() => {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      if (calendar.allEvents.value.some(e => e.date === todayStr)) {
        calendar.selectedDate.value = todayStr;
      }
    });

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
      prevMonth: calendar.prevMonth,
      nextMonth: calendar.nextMonth,
      goToday: calendar.goToday,
      selectDate: calendar.selectDate,
      toggleMember: filter.toggleMember,
      clearMemberFilter: filter.clearMemberFilter,
      toggleFutureOnly: filter.toggleFutureOnly,
      showDetail,

      // Utilities
      formatDate,
      getDayOfWeek,
      pad
    };
  }
});
