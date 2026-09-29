# 数据来源与许可

应用代码的 MIT 许可不替代各数据来源的许可。

## 铁路轨迹

`app/data/rail-routes.json` 中的铁路轨迹源自开放街图，经 BRouter 铁路路径计算整理，采用 [开放数据库许可协议 ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。

数据署名：© [开放街图贡献者](https://www.openstreetmap.org/copyright)。

各线路保留来源链接、获取时间、轨道标记和参考时刻表。导出的铁路 GeoJSON 同样包含来源及许可信息。轨迹是依据现有轨道重建的线路，不是旅客或历史列车的定位记录。

## 车站与底图

车站坐标的来源链接保留在 `app/data/stations.json` 和各线路的途经站记录中。世界底图来自 `world-atlas` 所提供的 Natural Earth 数据；依赖包保留各自的许可声明。

## 示例行程

`app/data/demo-train-data.json`、表格模板和测试中的行程均为虚构示例，不表示任何人的真实出行，也不作为实际购票或时刻表信息。

用户自行导入的行程不属于仓库公开数据。原始表格、`.local` 目录和本地输出文件不随本项目发布。
