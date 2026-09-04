# HDS-Interlude 双 NapCat 服务器部署

这套配置用于一台 Linux amd64 服务器上的两个独立 QQ Bot：

- Bot 1：QQ `<BOT_1_QQ>`，宿主机 OneBot WebSocket `127.0.0.1:3001`，WebUI `127.0.0.1:6099`；
- Bot 2：QQ `<BOT_2_QQ>`，宿主机 OneBot WebSocket `127.0.0.1:3002`，WebUI `127.0.0.1:6100`。

## 固定版本

- NapCat：`4.15.19`；
- Linux QQ：`3.2.21-42086`；
- 镜像标签：`mlikiowa/napcat-docker:v4.15.19`；
- 固定镜像摘要：`sha256:77c9fa8d8ae05b6a15251e3f0121392b466828444877b276b57aca0e9ff776e0`。

Compose 实际使用摘要而不是可变标签。`verify-versions.sh` 会同时检查标签与摘要是否指向同一镜像，并从容器内的 Debian 包和 QQ `package.json` 两处校验 Linux QQ 版本。校验失败时不要登录账号，也不要启动 Koishi。

## 1. 上传并启动

将本目录上传到服务器后执行：

```bash
cd /opt/hds-interlude/napcat
cp .env.example .env
chmod 600 .env
chmod +x deploy.sh verify-versions.sh
./deploy.sh
```

两个实例使用完全分开的 `data/instance-1` 和 `data/instance-2`。不要互相复制 QQ 数据目录或 NapCat 配置目录。Compose 还为两个容器固定了不同的主机名和 MAC 地址，降低容器重建造成设备身份漂移的概率。

## 2. 从本机访问 WebUI

服务器没有公开 WebUI 和 OneBot 端口。先在自己的电脑保持以下 SSH 隧道：

```bash
ssh -L 6099:127.0.0.1:6099 -L 6100:127.0.0.1:6100 your-server
```

然后访问：

- Bot 1：`http://127.0.0.1:6099/webui`；
- Bot 2：`http://127.0.0.1:6100/webui`。

WebUI 初始 Token 直接在服务器查看，禁止复制到仓库：

```bash
docker logs hds-napcat-1
docker logs hds-napcat-2
```

分别扫码登录正确的 QQ。登录完成后，在两个 WebUI 中各自启用 OneBot 11 WebSocket 服务器，容器内监听地址填 `0.0.0.0`，端口都填 `3001`，并分别设置不同的高强度 Access Token。

## 3. Koishi 对接

Koishi 如果直接运行在同一台 Linux 宿主机，现有地址无需改变：

| 实例 | `selfId` | `endpoint` | Token |
| --- | --- | --- | --- |
| Bot 1 | `<BOT_1_QQ>` | `ws://127.0.0.1:3001` | 与 Bot 1 的 NapCat 一致 |
| Bot 2 | `<BOT_2_QQ>` | `ws://127.0.0.1:3002` | 与 Bot 2 的 NapCat 一致 |

不要交换两个 Token，也不要让两个 HDSI 实例同时接管同一 QQ。

当前定制插件安装包为：

```text
koishi-plugin-hds-interlude-0.1.5-beta8-m6.custom.4.tgz
SHA256 03AB95C4249D9250F0A46EAB42D837181F7C4F7783D6E96408CE5AF395AF3A48
```

迁移 Koishi 时应单独、安全地传输以下内容，不要提交到 Git：

- `.local-hdsi/koishi-app/koishi.yml`；
- `.local-hdsi/koishi-app/.env`；
- `.local-hdsi/koishi-app/data/koishi.db`；
- 上述定制插件 tgz。

先停止本机 Koishi，再复制数据库，避免本机与服务器同时运行同一组 QQ Bot。数据库迁移后再在服务器安装依赖和定制插件。

## 4. 验收与维护

```bash
cd /opt/hds-interlude/napcat
./verify-versions.sh
docker compose ps
docker logs --since 30m hds-napcat-1
docker logs --since 30m hds-napcat-2
```

验收至少包括：

- 两个容器都在运行，且没有反复重启；
- Linux QQ 版本为 `3.2.21-42086`；
- 两个 QQ 均登录到正确账号；
- Koishi 的两个 OneBot 适配器分别连接 `3001` 和 `3002`；
- 两套 `data` 目录独立，重建容器后仍能保留登录与配置；
- 公网侧无法直接访问 `3001`、`3002`、`6099`、`6100`。

更新时不要使用 `latest`，也不要只改标签。先在隔离环境验证目标镜像内的 Linux QQ 版本、摘要和登录稳定性，再同时更新 Compose 与校验脚本。

截图中的 63 小时在线记录是单账号、单环境经验，不能证明 `4.15.19` 必然消除掉线。版本锁定只能排除镜像漂移；仍应继续观察 `KickedOffline`、登录失效、容器重启次数和宿主机网络。
