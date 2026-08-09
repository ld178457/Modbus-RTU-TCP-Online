<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ collapsed }">
      <div class="brand">
        <img src="/Modbus-online.svg" alt="" class="brand-logo" />
        <span v-show="!collapsed" class="brand-text">Modbus 在线调试</span>
      </div>

      <el-menu
        :default-active="activeIndex"
        :collapse="collapsed"
        :collapse-transition="false"
        background-color="#545c64"
        text-color="#fff"
        active-text-color="#ffd04b"
        router
        class="side-menu"
      >
        <el-menu-item index="/rtu">
          <el-icon><Connection /></el-icon>
          <template #title>Modbus RTU 调试</template>
        </el-menu-item>
        <el-menu-item index="/tcp">
          <el-icon><Promotion /></el-icon>
          <template #title>Modbus TCP 调试</template>
        </el-menu-item>
        <el-menu-item index="/help">
          <el-icon><QuestionFilled /></el-icon>
          <template #title>使用帮助</template>
        </el-menu-item>
      </el-menu>

      <div v-show="!collapsed" class="qr-card">
        <img src="/wechat-qr.jpg" alt="公众号二维码" class="qr-img" />
        <p class="qr-text">公众号：科苑沐泽</p>
      </div>

      <button class="collapse-btn" :title="collapsed ? '展开侧栏' : '收起侧栏'" @click="collapsed = !collapsed">
        <el-icon>
          <component :is="collapsed ? Expand : Fold" />
        </el-icon>
      </button>
    </aside>

    <main class="content">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Promotion, Connection, QuestionFilled, Fold, Expand } from '@element-plus/icons-vue'

const route = useRoute()
const collapsed = ref(false)

// 由当前路由驱动高亮，避免手动维护 index 与路由不同步
const activeIndex = computed(() => route.path)
</script>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 210px;
  background-color: #545c64;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.2s ease;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar.collapsed {
  width: 64px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 14px;
  background-color: #40e0d0;
  overflow: hidden;
  white-space: nowrap;
}

.brand-logo {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.brand-text {
  font-size: 15px;
  font-weight: 700;
  color: #10557f;
}

.side-menu {
  border-right: none;
  flex: 1;
}

.qr-card {
  padding: 16px 14px;
  text-align: center;
  background-color: rgba(255, 255, 255, 0.04);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.qr-img {
  width: 132px;
  height: 132px;
  border-radius: 6px;
  object-fit: cover;
  background-color: #fff;
  display: block;
  margin: 0 auto 10px;
}

.qr-text {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.4;
}

.collapse-btn {
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  padding: 12px;
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.collapse-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}

.collapse-btn:focus-visible {
  outline: 2px solid #ffd04b;
  outline-offset: -2px;
}

.content {
  flex: 1;
  padding: 16px;
  overflow-x: hidden;
  min-width: 0;
}

@media (max-width: 768px) {
  .sidebar {
    width: 64px;
  }
  .brand-text {
    display: none;
  }
  .content {
    padding: 10px;
  }
}
</style>
