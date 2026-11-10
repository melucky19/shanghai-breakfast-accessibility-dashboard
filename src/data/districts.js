export const districtMeta = [
  { name: "黄浦区", shortName: "黄浦", center: [121.483572, 31.215946], urban: true },
  { name: "徐汇区", shortName: "徐汇", center: [121.439405, 31.162992], urban: true },
  { name: "长宁区", shortName: "长宁", center: [121.380949, 31.20737], urban: true },
  { name: "静安区", shortName: "静安", center: [121.450659, 31.270821], urban: true },
  { name: "普陀区", shortName: "普陀", center: [121.392042, 31.257895], urban: true },
  { name: "虹口区", shortName: "虹口", center: [121.485443, 31.276649], urban: true },
  { name: "杨浦区", shortName: "杨浦", center: [121.529302, 31.29835], urban: true },
  { name: "闵行区", shortName: "闵行", center: [121.418901, 31.087213], urban: false },
  { name: "宝山区", shortName: "宝山", center: [121.489934, 31.398896], urban: false },
  { name: "嘉定区", shortName: "嘉定", center: [121.250333, 31.383524], urban: false },
  { name: "浦东新区", shortName: "浦东", center: [121.567706, 31.245944], urban: false },
  { name: "金山区", shortName: "金山", center: [121.330736, 30.724697], urban: false },
  { name: "松江区", shortName: "松江", center: [121.223543, 31.03047], urban: false },
  { name: "青浦区", shortName: "青浦", center: [121.113021, 31.151209], urban: false },
  { name: "奉贤区", shortName: "奉贤", center: [121.458472, 30.912345], urban: false },
  { name: "崇明区", shortName: "崇明", center: [121.397516, 31.626946], urban: false },
];

export const districtByName = Object.fromEntries(
  districtMeta.map((district) => [district.name, district])
);

export const urbanNames = new Set(
  districtMeta.filter((district) => district.urban).map((district) => district.name)
);

export const timeBands = [15, 20, 30];

export const breakfastCategories = [
  { keyword: "早餐", category: "早餐服务", color: "#e45d31" },
  { keyword: "包子", category: "中式面点", color: "#d99d32" },
  { keyword: "咖啡", category: "咖啡烘焙", color: "#70806d" },
];

export const PUBLIC_MAP_CACHE_KEY = "shanghai-breakfast-osm-v1";
