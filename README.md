# 申城晨食 · 上海市早餐可达性分析平台

基于 Vue 3、ECharts 和 OpenStreetMap 的上海市早餐供给与通勤可达性大屏。

当前版本不接入高德地图，运行时也不再请求高德接口。

## 数据来源

- 上海行政区边界：DataV.GeoAtlas 本地 GeoJSON。
- 早餐候选地点：OpenStreetMap / Overpass API。
- 办公地点：OpenStreetMap 的 `office` 与 `building=office` 数据。
- 地点搜索：Photon / OpenStreetMap。
- 驾车与步行路径：OSRM / OpenStreetMap。
- 公共交通路径：使用起终点距离、换乘等待和平均速度估算，页面会明确标记为“估算”。
- 聊天推荐：智谱 GLM-4.7-Flash，高峰期自动使用智谱 GLM-4.5-Flash。

OpenStreetMap 的早餐点覆盖不等同于全部流动早餐摊点。页面使用“早餐候选”表述，不把开源地图记录冒充为政府登记数据。

## 打开方式

运行环境需要 Node.js 20.19 或更高版本。

1. 双击 `启动大屏.cmd`。
2. 浏览器会自动打开大屏。
3. 如果浏览器未自动打开，通常访问：

```text
http://localhost:5173/
```

已经构建时也可以运行生产服务：

```powershell
npm.cmd run build
npm.cmd start
```

生产服务默认地址：

```text
http://localhost:8787/
```

## 智谱配置

项目支持 `.env.local` 和 `.env.zhipu.local`。`.env.zhipu.local` 已被 Git 忽略。

```dotenv
ZHIPU_API_KEY=你的智谱 API Key
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_MODEL=glm-4.7-flash
ZHIPU_FALLBACK_MODEL=glm-4.5-flash
ZHIPU_PRIMARY_TIMEOUT_MS=20000
ZHIPU_TIMEOUT_MS=60000
```

GLM-4.7-Flash 遇到高峰期限流或排队超过 20 秒时，自动切换为同一智谱平台的 GLM-4.5-Flash。不会调用 DeepSeek、Ollama 或其他模型厂商。

智谱失败时会使用本地关键词解析和排序，聊天入口仍会显示“本地规则”状态。

## 地图与缓存

- 地图主体由本地 ECharts GeoJSON 绘制，不依赖第三方地图 Key。
- 超出上海行政区边界的记录会被过滤；早餐点按 1.5 公里网格聚合成密度气泡，避免原始点铺满地图。
- 首次加载会向 Overpass 请求早餐和办公地点数据，通常需要 60—100 秒。
- 成功后缓存到 `server/cache/public-map-pois.json`，有效期 24 小时。
- 后续打开直接读取缓存，不需要重新等待 Overpass。
- 点击右上角刷新可以重新获取，免费公共服务繁忙时继续使用上次缓存。

## 通勤早餐推荐

1. 点击地图右上方的“通勤早餐”。
2. 在聊天框输入路线、预算、口味和绕行限制。
3. 系统用 GLM 提取起点、终点、时间、预算和早餐偏好。
4. 地点存在多个候选时，从列表中确认准确地点。
5. 系统用 OSRM 计算步行或驾车路径，并从真实 OpenStreetMap 早餐候选中排序。
6. GLM 只从传入的候选点中选择，不生成虚构店铺。

示例：

```text
我 7:50 从上海大学宝山校区出发，8:30 前到静安寺，
想买包子，预算 15 元，绕行不超过 8 分钟。
```

也支持“我要六点半从梅陇中学去上海大学宝山，不想吃油的”这类口语输入：

- 六点半会识别为 06:30。
- 不完整地名会交给 Photon 模糊搜索并列候选。
- “不想吃油的”会转为清淡偏好，并排除油炸、油条、炸鸡、煎饼。
- 手动地点栏默认收起；只有名称存在多个候选时才自动展开。

推荐结果会显示路线距离、早餐绕行时间、通勤总时间以及匹配理由。

## 免费服务限制

- Photon 地点搜索和 OSRM 路径服务有公共使用频率限制。
- 公共交通没有接入实时公交数据，当前为距离估算。
- OpenStreetMap 的咖啡、快餐、烘焙店和面点记录覆盖不完整。
- 办公地点被限制为每区最多 90 个样本，避免浏览器计算量过大。
- 免费服务不可达时保留上次缓存，不会伪造实时成功状态。

## 目录

```text
src/
  assets/shanghai-districts.json   # 本地上海行政区边界
  components/DistrictMap.vue       # ECharts 地图
  services/public-map.js           # 数据集、地点搜索与通勤指标
  components/CommutePlanner.vue    # 聊天和早餐推荐
server/
  public-map-service.mjs           # Overpass、Photon、OSRM
  public-map-api.mjs               # 地图数据、搜索与路径接口
  llm-service.mjs                  # 智谱 GLM 对话与候选排序
  cache/public-map-pois.json       # 24 小时公共地图缓存
```

## 旧版留档

原高德版本保存在：

```text
outputs/高德版留档_20261110/高德版项目源码_20261110.zip
```

归档不包含 `.env.local`、模型 Key、`dist` 或 `node_modules`。
