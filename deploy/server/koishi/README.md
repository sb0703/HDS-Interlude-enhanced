# Koishi 服务迁移

服务器布局：

```text
/opt/hds-interlude/
├── .local-hdsi/koishi-app/       # Koishi 配置、数据库和依赖
├── koishi-deploy/                # 本目录的部署脚本与 systemd unit
├── koishi-plugin-hds-interlude-0.1.5-beta8-m6.custom.4.tgz
├── napcat/                       # 双 NapCat Compose
└── runtime/node-v20.19.0-linux-x64/
```

`install-runtime.sh` 从 Node.js 官方发布站下载 Node `20.19.0`，使用官方 `SHASUMS256.txt` 校验后解压到项目目录。它不会替换服务器系统自带的 Node 18。

默认部署根目录是 `/opt/hds-interlude`，可在执行脚本时用 `HDS_ROOT` 替换。systemd 模板使用专用账号 `hdsbot`；如果服务器使用其他账号或目录，安装前要同步修改 unit。

需要同步 NapCat Token 或执行 OneBot 配置校验时，通过环境变量传入账号，不要把真实 QQ 号写回脚本：

```bash
export HDS_ROOT=/opt/hds-interlude
export HDS_BOT_1_QQ='<BOT_1_QQ>'
export HDS_BOT_2_QQ='<BOT_2_QQ>'
```

应用迁移必须在本机 Koishi 完全停止、`koishi.db-wal` 和 `koishi.db-shm` 不存在时进行。以下文件含密钥或私有运行数据，只能通过 SSH/SCP 传输，不能提交到 Git：

- `.env`；
- `koishi.yml`；
- `data/koishi.db`；
- `data/assets` 和其他运行数据。

安装完成后的常用命令：

```bash
sudo systemctl status hds-interlude-koishi
sudo journalctl -u hds-interlude-koishi -f
sudo systemctl restart hds-interlude-koishi
sudo systemctl stop hds-interlude-koishi
```

Koishi Console 监听策略仍由迁移后的 `koishi.yml` 决定。正式开放前应通过防火墙或 SSH 隧道限制 `5140`，不得直接裸露管理界面。
