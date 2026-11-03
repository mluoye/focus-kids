<script setup lang="ts">
defineProps<{
  /** 骨架屏类型：卡片、列表、表单 */
  type?: 'card' | 'list' | 'form'
  /** 重复次数（列表类型用） */
  count?: number
}>()
</script>

<template>
  <div class="skeleton-loader">
    <!-- 卡片骨架 -->
    <div v-if="type === 'card'" class="skeleton-card">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-content">
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line skeleton-line--text"></div>
        <div class="skeleton-line skeleton-line--text skeleton-line--short"></div>
      </div>
    </div>

    <!-- 列表骨架 -->
    <div v-else-if="type === 'list'" class="skeleton-list">
      <div v-for="i in (count ?? 3)" :key="i" class="skeleton-item">
        <div class="skeleton-avatar skeleton-avatar--small"></div>
        <div class="skeleton-content">
          <div class="skeleton-line skeleton-line--title"></div>
          <div class="skeleton-line skeleton-line--text"></div>
        </div>
      </div>
    </div>

    <!-- 表单骨架 -->
    <div v-else-if="type === 'form'" class="skeleton-form">
      <div class="skeleton-line skeleton-line--label"></div>
      <div class="skeleton-input"></div>
      <div class="skeleton-line skeleton-line--label"></div>
      <div class="skeleton-input"></div>
      <div class="skeleton-button"></div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-loader {
  width: 100%;
}

.skeleton-card,
.skeleton-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skeleton-avatar {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  flex-shrink: 0;
}

.skeleton-avatar--small {
  width: 2.5rem;
  height: 2.5rem;
}

.skeleton-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.skeleton-line {
  height: 0.75rem;
  border-radius: 0.25rem;
  background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-line--title {
  width: 40%;
  height: 1rem;
}

.skeleton-line--text {
  width: 80%;
}

.skeleton-line--short {
  width: 60%;
}

.skeleton-line--label {
  width: 30%;
  height: 0.875rem;
  margin-bottom: 0.25rem;
}

.skeleton-input {
  height: 2.5rem;
  border-radius: 0.375rem;
  background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  margin-bottom: 1rem;
}

.skeleton-button {
  height: 2.5rem;
  width: 100%;
  border-radius: 0.375rem;
  background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-form {
  display: flex;
  flex-direction: column;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
