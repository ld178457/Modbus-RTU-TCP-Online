const { defineConfig } = require('@vue/cli-service')
const AutoImport = require('unplugin-auto-import/webpack')
const Components = require('unplugin-vue-components/webpack')
const { ElementPlusResolver } = require('unplugin-vue-components/resolvers')

module.exports = defineConfig({
    transpileDependencies: true,
    // 全量引入 Element Plus 体积偏大（约 1.4 MiB）。
    // 改用按需自动引入：用到哪个组件才打进 bundle，CSS 也由解析器自动补全。
    chainWebpack: (config) => {
        config.plugin('auto-import').use(
            AutoImport({
                imports: ['vue'],
                resolvers: [ElementPlusResolver()],
                dts: false
            })
        )
        config.plugin('components').use(
            Components({
                resolvers: [ElementPlusResolver()],
                dts: false
            })
        )
    },
    devServer: {
        proxy: {
            // 如果需要 WebSocket 代理，取消注释下面的配置
            // '/ws': {
            //   target: 'ws://192.168.43.43:8081',
            //   ws: true,
            //   changeOrigin: true
            // }
        },
        allowedHosts: 'all'
    },
    configureWebpack: {
        devtool: 'source-map'
    }
})