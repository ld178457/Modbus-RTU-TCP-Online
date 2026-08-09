import store from '../store'
import { ref, watchEffect, onUnmounted } from 'vue'
// 模拟串口控制模块 - 适用于 Web 环境
let serialport = null
let isConnected = false
const isReceiving = ref(false)
const portReader = ref(null)
const error = ref(null)
const buffer = ref(new Uint8Array(0)) // 数据缓冲区



export default {
  // 新增：请求用户授权串口
  async requestPort() {
    if ('serial' in navigator) {
      try {
        console.log('开始请求串口授权...')
        const port = await navigator.serial.requestPort()
        // 在请求前先获取已授权的端口列表
        // const portsBefore = await navigator.serial.getPorts()
        // console.log('请求前的已授权端口数量:', portsBefore.length)
        return port
      } catch (error) {
        console.log('=== 串口授权错误 ===')
        console.log('错误类型:', error.name)
        console.log('错误消息:', error.message)
        console.log('完整错误:', error)
        console.log('=== 错误信息结束 ===')
        return null
      }
    } else {
      console.log('浏览器不支持 Web Serial API')
      return null
    }
  },
  // 将单个串口信息添加到 store
  serialScan(port) {
    console.log('处理串口信息:', port)
    try {
      if (port && port.getInfo) {
        const portInfo = port.getInfo()

        // 尝试多种方式获取串口标识
        let comName = 'Unknown Port'
        let manufacturer = 'Unknown'
        let serialNumber = 'Unknown'

        // 方法1: 使用 USB 信息
        if (portInfo.usbVendorId && portInfo.usbProductId) {
          comName = `USB-${portInfo.usbVendorId}-${portInfo.usbProductId}`
          manufacturer = 'USB Device'
          serialNumber = portInfo.usbProductId.toString()
        }
        // 方法2: 使用串口标签（如果有的话）
        else if (portInfo.serialNumber) {
          comName = `Serial-${portInfo.serialNumber}`
          manufacturer = 'Serial Device'
          serialNumber = portInfo.serialNumber
        }
        // 方法3: 虚拟串口处理
        else {
          // 检查是否为VSPD虚拟串口（getInfo()返回空对象）
          const isVSPDVirtual = Object.keys(portInfo).length === 0

          if (isVSPDVirtual) {
            // 首先检查这个串口对象是否已经存在于store中
            const existingPorts = store.getters.portList
            const existingPort = existingPorts.find(p => p.port === port)

            if (existingPort) {
              // 如果串口对象已存在，使用现有的名称
              comName = existingPort.comName
              manufacturer = existingPort.manufacturer
              serialNumber = existingPort.serialNumber
              console.log('使用已存在的串口信息:', existingPort)
            } else {
              // 如果串口对象不存在，生成新的名称
              const vspdPorts = existingPorts.filter(p => p.comName.includes('VSPD-Virtual-Port'))
              const nextIndex = vspdPorts.length

              comName = `VSPD-Virtual-Port-${nextIndex}`
              manufacturer = 'VSPD Virtual Serial Port'
              serialNumber = `VSPD-${nextIndex}`
              console.log('生成新的VSPD虚拟串口名称:', comName)
            }
          } else {
            // 其他虚拟串口处理
            const virtualPorts = ['COM1', 'COM2', 'COM3', 'COM4', 'COM5']
            const existingPorts = store.getters.portList.map(p => p.comName)
            const availablePort = virtualPorts.find(p => !existingPorts.includes(p))

            comName = availablePort || `Virtual-${Date.now()}`
            manufacturer = 'Virtual Serial Port'
            serialNumber = 'Virtual'
          }
        }

        const serialPortInfo = {
          comName: comName,
          manufacturer: manufacturer,
          serialNumber: serialNumber,
          port: port,
          isVirtual: !portInfo.usbVendorId && !portInfo.usbProductId,
          rawInfo: portInfo // 保存原始信息用于调试
        }

        console.log('提取的串口信息:', serialPortInfo)

        // 设置当前选择的串口
        store.dispatch('setSelectedPort', serialPortInfo)
        // 添加到串口列表
        store.dispatch('addPort', serialPortInfo)
        return serialPortInfo
      } else {
        console.error('无效的串口对象:', port)
        return null
      }
    } catch (error) {
      console.error('处理串口信息失败:', error)
      return null
    }
  },
  // CRC16 校验码计算函数
  /**
 * @param {string[]} dataBytes - 字符串数组，每个字符串是一个十六进制字节
 */
  calculateCRC16(dataBytes) {
    let crc = 0xFFFF

    for (let i = 0; i < dataBytes.length; i++) {
      crc ^= parseInt(dataBytes[i], 16)

      for (let j = 0; j < 8; j++) {
        if (crc & 0x0001) {
          crc = (crc >> 1) ^ 0xA001
        } else {
          crc = crc >> 1
        }
      }
    }
    //小端序
    const lowByte = (crc & 0xFF).toString(16).padStart(2, '0')
    const highByte = ((crc >> 8) & 0xFF).toString(16).padStart(2, '0')
    return (lowByte + highByte).toUpperCase()
  },

  sendDataToSerialPort: async (dataArray) => {
    try {
      const selectedPort = store.getters.selectedPort
      if (!selectedPort || !selectedPort.port) {
        console.error('没有选择串口')
        return
      }

      const port = selectedPort.port

      // 检查串口是否已打开
      if (!port.readable || !port.writable) {
        console.error('串口未打开')
        return
      }

      // 获取写入器
      const writer = port.writable.getWriter()

      // 将number数组转换为Uint8Array
      const uint8Array = new Uint8Array(dataArray)

      // 发送数据
      await writer.write(uint8Array)
      store.dispatch('setSendStatus', "success")
      console.log('数据发送成功:', dataArray)

      // 释放写入器
      writer.releaseLock()

    } catch (error) {
      console.error('串口发送数据失败:', error)
      store.dispatch('setSendStatus', "danger")
    }
  },
  // 校验 Modbus RTU 响应帧
  validateModbusResponse: function (dataArray) {  // 改为 function 声明
    try {
      // 检查最小长度 (从站地址 + 功能码 + CRC = 4字节)
      if (dataArray.length < 4) {
        return {
          isValid: false,
          error: '数据长度不足'
        }
      }

      const slaveId = dataArray[0]
      const functionCode = dataArray[1]

      // 检查从站地址范围 (1-247)
      if (slaveId < 1 || slaveId > 247) {
        return {
          isValid: false,
          error: '无效的从站地址: ' + slaveId
        }
      }

      // 检查功能码范围 (1-127)
      if (functionCode < 1 || functionCode > 127) {
        return {
          isValid: false,
          error: '无效的功能码: ' + functionCode
        }
      }

      // 检查异常响应 (功能码 + 0x80)
      if (functionCode > 0x80) {
        const exceptionCode = dataArray[2]
        if (dataArray.length !== 5) { // 异常响应固定长度
          return {
            isValid: false,
            error: '异常响应长度错误'
          }
        }

        // 校验CRC - 添加 this.
        const dataForCRC = dataArray.slice(0, -2)
        const receivedCRC = dataArray.slice(-2)
        if (!this.validateCRC16(dataForCRC, receivedCRC)) {
          return {
            isValid: false,
            error: 'CRC校验失败'
          }
        }

        return {
          isValid: true,
          error: null
        }
      }

      // 正常响应校验
      let expectedLength = 0

      switch (functionCode) {
        case 0x01: // 读线圈
        case 0x02: // 读离散输入
          if (dataArray.length < 4) {
            return {
              isValid: false,
              error: '读线圈/离散输入响应长度不足'
            }
          }
          {
            const byteCount = dataArray[2];
            expectedLength = 3 + byteCount + 2; // 从站地址(1) + 功能码(1) + 字节数(1) + 数据(N) + CRC(2)
          }
          break

        case 0x03: // 读保持寄存器
        case 0x04: // 读输入寄存器
          if (dataArray.length < 4) {
            return {
              isValid: false,
              error: '读寄存器响应长度不足'
            }
          }
          const byteCount = dataArray[2]
          expectedLength = 3 + byteCount + 2 // 从站地址(1) + 功能码(1) + 字节数(1) + 数据(N) + CRC(2)
          break

        case 0x05: // 写单个线圈
        case 0x06: // 写单个寄存器
          expectedLength = 8 // 固定长度：从站地址(1) + 功能码(1) + 地址(2) + 值(2) + CRC(2)
          break

        case 0x0F: // 写多个线圈
        case 0x10: // 写多个寄存器
          expectedLength = 8 // 固定长度：从站地址(1) + 功能码(1) + 起始地址(2) + 数量(2) + CRC(2)
          break

        default:
          return {
            isValid: false,
            error: '不支持的功能码: ' + functionCode
          }
      }

      // 添加调试信息
      console.log('长度校验详情:', {
        functionCode: functionCode,
        byteCount: dataArray[2],
        expectedLength: expectedLength,
        actualLength: dataArray.length,
        dataArray: dataArray
      })

      if (dataArray.length !== expectedLength) {
        return {
          isValid: false,
          error: `长度不匹配: 期望${expectedLength}字节，实际${dataArray.length}字节`
        }
      }

      // 校验CRC - 添加 this.
      const dataForCRC = dataArray.slice(0, -2)
      const receivedCRC = dataArray.slice(-2)
      if (!this.validateCRC16(dataForCRC, receivedCRC)) {
        return {
          isValid: false,
          error: 'CRC校验失败'
        }
      }

      return {
        isValid: true,
        error: null
      }

    } catch (error) {
      return {
        isValid: false,
        error: '校验过程出错: ' + error.message
      }
    }
  },
  // 开始监听串口数据
  startReading: async function () {
    try {
      const selectedPort = store.getters.selectedPort
      if (!selectedPort || !selectedPort.port) {
        console.error('没有选择串口')
        return
      }

      const port = selectedPort.port

      // 检查串口是否已打开
      if (!port.readable) {
        console.error('串口未打开或不可读')
        return
      }
      // 避免重复获取 reader
      if (port.readable.locked) {
        console.log('已在读取中，跳过重复启动')
        return
      }
      // 获取读取器
      const reader = port.readable.getReader()
      portReader.value = reader
      isReceiving.value = true

      console.log('开始监听串口数据...')

      try {
        const { value, done } = await reader.read()
        if (done) {
          console.log('串口读取完成')
          return
        }
        if (value && value.length > 0) {
          const normalArray = Array.from(value)
          const hexString = normalArray
            .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
            .join(' ')

          console.log('接收到数据(普通数组):', normalArray)

          const validationResult = this.validateModbusResponse(normalArray)
          console.log('Modbus响应校验结果:', validationResult)
          store.dispatch('setRecNumberArray', normalArray)
          if (validationResult.isValid) {
            store.dispatch('pushNewData', {
              originData: hexString
            })
            store.dispatch('setRecStatus', "success")
            console.log('Modbus响应验证成功')
          }
        }
      } catch (error) {
        store.dispatch('setRecStatus', "danger")
        console.error('读取串口数据失败:', error)
      }

    } catch (error) {
      console.error('启动串口监听失败:', error)
    } finally {
      try {
        await portReader.value.cancel()
      } catch (e) { }

      try {
        portReader.value.releaseLock()
      } catch (e) {
        console.log('释放锁时出错:', e)
      }
      portReader.value = null
      isReceiving.value = false
    }

  },

  // CRC16 校验函数
  validateCRC16: function (dataArray, receivedCRC) {
    try {
      // 将数字数组转换为十六进制字符串数组
      const hexStrings = dataArray.map(byte => byte.toString(16).padStart(2, '0'))

      // 计算CRC
      const calculatedCRCString = this.calculateCRC16(hexStrings)

      // 将计算出的CRC字符串转换为字节数组进行比较
      const calculatedBytes = calculatedCRCString.match(/.{2}/g).map(hex => parseInt(hex, 16))

      console.log('CRC校验详情:', {
        dataArray: dataArray,
        hexStrings: hexStrings,
        calculatedCRCString: calculatedCRCString,
        calculatedBytes: calculatedBytes,
        receivedCRC: receivedCRC
      })

      // 比较CRC（小端序）
      const isValid = calculatedBytes[0] === receivedCRC[0] && calculatedBytes[1] === receivedCRC[1]

      if (!isValid) {
        console.log('CRC不匹配:', {
          calculated: calculatedBytes,
          received: receivedCRC
        })
      }

      return isValid
    } catch (error) {
      console.error('CRC校验失败:', error)
      return false
    }
  },

}
