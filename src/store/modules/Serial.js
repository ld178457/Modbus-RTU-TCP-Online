const state = {
  receivedData: [],
  sendData: [],
  serialportOpened: false,
  portList: [],
  selectedPort: null, // 当前选择的串口
  sendNumberArray: "", // 待发送的数字数组
  recNumberArray: [], // 当前接收到的数字数组
  recMaxNum: 50, //接收发送最大储存数组
  autoClear: false, //是否自动清理
  sendStatus: "", // 发送状态
  recStatus: "" // 接收状态
}

const getters = {
  serialportOpened: state => {
    return state.serialportOpened
  },
  receivedData: state => {
    return state.receivedData
  },
  sendData: state => {
    return state.sendData
  },
  // 串口列表: 储存已经连接过的串口实例
  portList: state => {
    return state.portList
  },
  // 正在连接的当前串口
  selectedPort: state => {
    return state.selectedPort
  },
  sendNumberArray: state => {
    return state.sendNumberArray
  },
  recNumberArray: state => {
    return state.recNumberArray
  },
  recMaxNum: state => {
    return state.recMaxNum
  },
  autoClear: state => {
    return state.autoClear
  },
  sendStatus: state => {
    return state.sendStatus
  },
  recStatus: state => {
    return state.recStatus
  }
}

const mutations = {
  SET_SERIALPORT_STATE_OPEN(state) {
    state.serialportOpened = true
  },
  SET_SERIALPORT_STATE_CLOSE(state) {
    state.serialportOpened = false
  },
  PUSH_NEW_DATA(state, data) {
    let date = new Date()
    let time = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds().toString().padStart(2, '0')}`

    state.receivedData.push({
      time: time,
      ...data
    })
    if (state.receivedData.length > 7 && state.autoClear) {
      state.receivedData = state.receivedData.slice(-7)
    }
    while (state.receivedData.length > state.recMaxNum) {
      state.receivedData.shift();
    }
  },
  PUSH_NEW_SEND_DATA(state, data) {
    let date = new Date()
    let time = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds().toString().padStart(2, '0')}`

    state.sendData.push({
      time: time,
      ...data
    })
    if (state.sendData.length > 7 && state.autoClear) {
      state.sendData = state.sendData.slice(-7)
    }
    while (state.sendData.length > state.recMaxNum) {
      state.sendData.shift();
    }
  },
  CLEAR_DATA(state) {
    state.receivedData.length = 0
    state.sendData.length = 0
  },
  // 新增：设置串口列表
  SET_PORT_LIST(state, portList) {
    state.portList = portList
  },
  // 新增：清空串口列表
  CLEAR_PORT_LIST(state) {
    state.portList = []
  },
  // 新增：添加单个串口
  ADD_PORT(state, port) {
    // 检查是否已存在，避免重复添加（基于串口对象和名称双重检查）
    const existsByName = state.portList.some(p => p.comName === port.comName)
    const existsByObject = state.portList.some(p => p.port === port.port)

    if (!existsByName && !existsByObject) {
      state.portList.push(port)
      console.log('添加新串口到列表:', port.comName)
    } else {
      console.log('串口已存在，跳过添加:', port.comName)
    }
  },
  // 新增：设置当前选择的串口
  SET_SELECTED_PORT(state, port) {
    state.selectedPort = port
  },
  // 新增：清除当前选择的串口
  CLEAR_SELECTED_PORT(state) {
    state.selectedPort = null
  },
  // 设置待发送的数字数组 
  SET_SEND_NUMBER_ARRAY(state, sendNumberArray) {
    state.sendNumberArray = sendNumberArray
  },
  // 设置这一帧接收的数据数组
  SET_REC_NUMBER_ARRAY(state, recNumberArray) {
    state.recNumberArray = recNumberArray
  },
  SET_REC_MAX_NUM(state, recMaxNum) {
    state.recMaxNum = recMaxNum
  },
  SET_AUTO_CLEAR(state, autoClear) {
    state.autoClear = autoClear
  },
  SET_SEND_STATUS(state, sendStatus) {
    state.sendStatus = sendStatus
  },
  SET_REC_STATUS(state, recStatus) {
    state.recStatus = recStatus
  }
}

const actions = {
  setSerialportStateOpen({ commit }) {
    commit('SET_SERIALPORT_STATE_OPEN')
  },
  setSerialportStateClose({ commit }) {
    commit('SET_SERIALPORT_STATE_CLOSE')
  },
  pushNewData({ commit }, data) {
    commit('PUSH_NEW_DATA', data)
  },
  pushNewSendData({ commit }, data) {
    commit('PUSH_NEW_SEND_DATA', data)
  },
  clearData({ commit }) {
    commit('CLEAR_DATA')
  },
  // 新增：设置串口列表
  setPortList({ commit }, portList) {
    commit('SET_PORT_LIST', portList)
  },
  // 新增：清空串口列表
  clearPortList({ commit }) {
    commit('CLEAR_PORT_LIST')
  },
  // 新增：添加单个串口
  addPort({ commit }, port) {
    commit('ADD_PORT', port)
  },
  // 新增：设置当前选择的串口
  setSelectedPort({ commit }, port) {
    commit('SET_SELECTED_PORT', port)
  },
  // 新增：清除当前选择的串口
  clearSelectedPort({ commit }) {
    commit('CLEAR_SELECTED_PORT')
  },
  // 设置待发送的数字数组 
  setSendNumberArray({ commit }, sendNumberArray) {
    commit('SET_SEND_NUMBER_ARRAY', sendNumberArray)
  },
  // 设置这一帧接收的数据数组
  setRecNumberArray({ commit }, recNumberArray) {
    commit('SET_REC_NUMBER_ARRAY', recNumberArray)
  },
  setRecMaxNum({ commit }, recMaxNum) {
    commit('SET_REC_MAX_NUM', recMaxNum)
  },
  setAutoClear({ commit }, autoClear) {
    commit('SET_AUTO_CLEAR', autoClear)
  },
  setSendStatus({ commit }, sendStatus) {
    commit('SET_SEND_STATUS', sendStatus)
  },
  setRecStatus({ commit }, recStatus) {
    commit('SET_REC_STATUS', recStatus)
  },
}

export default {
  state,
  getters,
  mutations,
  actions
}
