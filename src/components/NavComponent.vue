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

      <div v-show="!collapsed" class="wx-card">
        <span class="wx-label"><i class="wx-dot" aria-hidden="true"></i>扫码关注</span>
        <div class="wx-qr-frame">
          <img src="/wechat-qr.jpg" alt="公众号：科苑沐泽 二维码" class="wx-qr" />
        </div>
        <p class="wx-name">公众号：<span class="wx-accent">科苑沐泽</span></p>
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

.wx-card {
  margin: 14px 12px 12px;
  padding: 14px 14px 12px;
  text-align: center;
  border-radius: 12px;
  background: linear-gradient(155deg, rgba(64, 224, 208, 0.10), rgba(255, 255, 255, 0.025));
  border: 1px solid rgba(64, 224, 208, 0.18);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.20);
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}

.wx-card:hover {
  transform: translateY(-2px);
  border-color: rgba(64, 224, 208, 0.38);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
}

.wx-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.55);
}

.wx-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #07c160;
  box-shadow: 0 0 6px #07c160;
  animation: wx-pulse 1.8s ease-in-out infinite;
}

@keyframes wx-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.78); }
}

.wx-qr-frame {
  width: 122px;
  height: 122px;
  margin: 0 auto 12px;
  padding: 7px;
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(0, 0, 0, 0.05);
}

.wx-qr {
  width: 100%;
  height: 100%;
  border-radius: 5px;
  display: block;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.wx-card:hover .wx-qr {
  transform: scale(1.03);
}

.wx-name {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.02em;
}

.wx-accent {
  color: #07c160;
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
  .wx-card {
    display: none;
  }
  .content {
    padding: 10px;
  }
}
</style>
