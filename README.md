# 新网安全组规则备注

一个 Manifest V3 浏览器扩展。在新网云主机详情页的安全组规则表格中增加“备注”列，并显示安全组规则接口中的 `remark` 字段。

## 安装

1. 打开 Chrome 或 Edge 的扩展管理页：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录。
4. 刷新已经打开的新网云主机详情页。

扩展会在以下页面生效：

- `https://xcloud.xinnet.com/#/siteCloud/hostDetail...`
- `https://xcloud.xinnet.com/#/network/safeDetail...`

## 数据来源

扩展使用当前浏览器的新网登录状态请求：

```text
https://xcloud.xinnet.com/api/security/group/rules/98fae34b970240349e2a508600ac7119
```

规则通过表头名称定位优先级、协议、端口、授权对象和创建时间，因此兼容两个页面不同的列结构。备注列会插入在固定“操作”列之前，占用表格现有宽度并按比例压缩非固定列，不会产生空白列或横向滚动条。

在安全组详情页中，扩展只读取单元格的可见内容，会忽略组件用于展示省略效果的隐藏 `...`，确保端口和授权对象能与接口数据正确匹配。
